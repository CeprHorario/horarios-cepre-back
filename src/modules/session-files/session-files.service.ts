import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { File, Prisma } from '../../generated/prisma/client';
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { ClassSessionRecordsService } from '../class-session-records/class-session-records.service';
import {
  json,
  SessionActor,
  SessionPrincipal,
} from '../class-session-records/session.types';
import {
  AssociateSessionCaptureDto,
  ThumbnailReferenceDto,
} from './session-files.dto';
import { VersionDto } from '../class-session-records/session.dto';
import { validateSessionFile } from './session-file.validation';
import { SessionObjectStorage } from './session-object-storage.service';

@Injectable()
export class SessionFilesService {
  private readonly logger = new Logger(SessionFilesService.name);
  private thumbnailWork = 0;
  constructor(
    private readonly records: ClassSessionRecordsService,
    private readonly objects: SessionObjectStorage,
  ) {}

  async upload(
    principal: SessionPrincipal,
    recordId: number,
    input?: Express.Multer.File,
    administrative = false,
    reason?: string,
  ) {
    const file = validateSessionFile(input);
    const { client, schema, actor } = await this.records.context(principal);
    if (administrative || actor.role === Role.ADMIN) {
      this.records.admin(actor);
      this.records.reason(reason);
    }
    const bucket = this.objects.bucketName();
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const pending = await this.records.transaction(
      client,
      schema,
      async (tx) => {
        await this.records.lock(tx, recordId);
        const record = await this.records.authorizeRecord(
          tx,
          actor,
          recordId,
          !administrative,
          false,
          reason,
        );
        if (administrative)
          await tx.$queryRaw`SELECT set_config('cepr.session_override','true',true)`;
        else await this.records.assertWritable(tx, actor, record, reason);
        const [{ id }] = await tx.$queryRaw<
          { id: string }[]
        >`SELECT uuidv7()::text AS id`;
        const created = await tx.file.create({
          data: {
            id,
            recordId,
            bucket,
            objectName: `session-files/${schema}/${recordId}/${id}.png`,
            originalName: file.originalname,
            contentType: 'image/png',
            size: file.buffer.length,
            checksum,
            uploadedBy: json(actor),
            status: 'PENDING',
          },
        });
        await this.records.audit(
          tx,
          actor,
          recordId,
          administrative ? 'ADMIN_FILE_UPLOAD_PENDING' : 'FILE_UPLOAD_PENDING',
          null,
          created,
          reason,
        );
        return created;
      },
    );
    let generation: string;
    try {
      generation = await this.objects.upload(
        bucket,
        pending.objectName,
        file.buffer,
        checksum,
      );
    } catch {
      await this.failUpload(client, actor, pending, reason);
      throw new ServiceUnavailableException(
        'No se pudo guardar el archivo; vuelva a subirlo',
      );
    }
    try {
      const current = await this.records.context(principal);
      if (
        current.schema !== schema ||
        current.actor.id !== actor.id ||
        current.actor.origin !== actor.origin
      )
        throw new ForbiddenException('El proceso o la cuenta ha cambiado');
      const available = await this.records.transaction(client, schema, async (tx) => {
        await this.records.lock(tx, recordId);
        const record = await this.records.authorizeRecord(
          tx,
          current.actor,
          recordId,
          !administrative,
          false,
          reason,
        );
        if (administrative) {
          this.records.admin(current.actor);
          await tx.$queryRaw`SELECT set_config('cepr.session_override','true',true)`;
        } else
          await this.records.assertWritable(tx, current.actor, record, reason);
        const available = await tx.file.update({
          where: { id: pending.id, status: 'PENDING' },
          data: { status: 'AVAILABLE', generation },
        });
        await this.records.audit(
          tx,
          current.actor,
          recordId,
          administrative
            ? 'ADMIN_FILE_UPLOAD_AVAILABLE'
            : 'FILE_UPLOAD_AVAILABLE',
          pending,
          available,
          reason,
        );
        return available;
      });
      // A derivative is expendable; failure never invalidates the canonical PNG.
      try { await this.thumbnail(client, actor, available, file.buffer); } catch { /* Lazy retry on the next authorized batch. */ }
      return available;
    } catch (error) {
      await this.failUpload(client, actor, pending, reason);
      throw error;
    }
  }

  private async failUpload(
    client: Awaited<
      ReturnType<ClassSessionRecordsService['context']>
    >['client'],
    actor: SessionActor,
    pending: File,
    reason?: string,
  ) {
    try {
      await this.records.transaction(client, actor.schema, async (tx) => {
        if (pending.recordId === null)
          throw new Error('Archivo sin parte de origen');
        await this.records.lock(tx, pending.recordId);
        const failed = await tx.file.update({
          where: { id: pending.id, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
        await this.records.audit(
          tx,
          actor,
          pending.recordId,
          'FILE_UPLOAD_FAILED',
          pending,
          failed,
          reason,
        );
      });
    } catch {
      // PENDING remains non-evidence and non-downloadable if the database is unavailable.
      this.logger.error(
        `No se pudo registrar el fallo de subida ${pending.id}; conserva estado pendiente`,
      );
    }
  }

  associate(
    principal: SessionPrincipal,
    recordId: number,
    slot: string,
    dto: AssociateSessionCaptureDto,
    administrative = false,
  ) {
    if (slot !== 'initial' && slot !== 'final')
      throw new BadRequestException('Captura initial o final');
    return this.records.mutate(
      principal,
      recordId,
      dto.expectedVersion,
      administrative ? 'ADMIN_CAPTURE_ASSOCIATED' : 'CAPTURE_ASSOCIATED',
      dto.reason,
      async (tx, _record, actor) => {
        if (_record.deletedAt)
          throw new ForbiddenException(
            'Restaure el parte antes de corregir sus capturas',
          );
        const file = await tx.file.findFirst({
          where: {
            id: dto.fileId,
            recordId,
            status: 'AVAILABLE',
            deletedAt: null,
          },
        });
        if (!file?.generation || !file.checksum)
          throw new NotFoundException(
            'Archivo disponible no encontrado en este parte',
          );
        const uploader = file.uploadedBy as unknown as SessionActor;
        if (
          actor.role !== Role.ADMIN &&
          (uploader.id !== actor.id ||
            uploader.origin !== actor.origin ||
            uploader.schema !== actor.schema)
        )
          throw new ForbiddenException(
            'Solo puede asociar sus propias subidas',
          );
        const at = await this.records.now(tx);
        return slot === 'initial'
          ? {
              initialFileId: file.id,
              initialAssociatedAt: at,
              initialAssociatedBy: json(actor),
            }
          : {
              finalFileId: file.id,
              finalAssociatedAt: at,
              finalAssociatedBy: json(actor),
            };
      },
      administrative,
    );
  }

  detach(
    principal: SessionPrincipal,
    recordId: number,
    slot: string,
    dto: VersionDto,
    administrative = false,
  ) {
    if (slot !== 'initial' && slot !== 'final')
      throw new BadRequestException('Captura initial o final');
    return this.records.mutate(
      principal,
      recordId,
      dto.expectedVersion,
      'CAPTURE_DETACHED',
      dto.reason,
      (_tx, record) => {
        if (record.deletedAt)
          throw new ForbiddenException(
            'Restaure el parte antes de corregir sus capturas',
          );
        return Promise.resolve(
          slot === 'initial'
            ? {
                initialFileId: null,
                initialAssociatedAt: null,
                initialAssociatedBy: Prisma.DbNull,
              }
            : {
                finalFileId: null,
                finalAssociatedAt: null,
                finalAssociatedBy: Prisma.DbNull,
              },
        );
      },
      administrative,
    );
  }

  async thumbnails(principal: SessionPrincipal, refs: ThumbnailReferenceDto[]) {
    if (
      !refs.length ||
      refs.length > 32 ||
      new Set(refs.map((r) => `${r.recordId}:${r.slot}`)).size !== refs.length
    )
      throw new BadRequestException('Seleccione hasta 32 capturas distintas');
    const { client, actor } = await this.records.context(principal);
    const authorized = await this.records.transaction(
      client,
      actor.schema,
      async (tx) => {
        const scope = await this.records.scope(tx, actor);
        const records = await tx.classSessionRecord.findMany({
          where: {
            ...scope,
            id: { in: refs.map((r) => r.recordId) },
            deletedAt: null,
          },
        });
        const files = await tx.file.findMany({
          where: {
            id: { in: refs.map((r) => r.fileId) },
            deletedAt: null,
            status: 'AVAILABLE',
          },
        });
        if (
          refs.some(
            (ref) =>
              !records.some((r) => r.id === ref.recordId) ||
              !files.some(
                (f) => f.id === ref.fileId && f.recordId === ref.recordId,
              ),
          )
        )
          throw new NotFoundException('Capturas no disponibles');
        await this.records.audit(
          tx,
          actor,
          null,
          'THUMBNAIL_BATCH_ACCESS',
          null,
          { references: refs },
        );
        return refs.map((ref) => ({
          ref,
          file: files.find((f) => f.id === ref.fileId)!,
          record: records.find((r) => r.id === ref.recordId)!,
        }));
      },
    );
    const data: (ThumbnailReferenceDto & {
      status: string;
      contentType?: string;
      width?: number;
      height?: number;
      content?: string;
    })[] = [];
    // ponytail: 32 referencias/lote y dos transformaciones por instancia; ampliar con mediciones, no cola ilimitada.
    const deadline = Date.now() + 20000;
    for (const { ref, file, record } of authorized) {
      if (
        (ref.slot === 'initial' ? record.initialFileId : record.finalFileId) !==
          ref.fileId ||
        file.generation !== ref.generation
      ) {
        data.push({ ...ref, status: 'STALE' });
        continue;
      }
      try {
        if (Date.now() >= deadline) throw new Error('Batch budget exhausted');
        const thumbnail = await this.thumbnail(client, actor, file, undefined, deadline);
        data.push({ ...ref, status: 'AVAILABLE', ...thumbnail });
      } catch {
        data.push({ ...ref, status: 'UNAVAILABLE' });
      }
    }
    const current = await this.records.context(principal);
    if (
      current.schema !== actor.schema ||
      current.actor.id !== actor.id ||
      current.actor.origin !== actor.origin
    )
      throw new ForbiddenException('El proceso o la cuenta ha cambiado');
    const latest = await this.records.transaction(
      client,
      actor.schema,
      async (tx) =>
        tx.classSessionRecord.findMany({
          where: {
            ...(await this.records.scope(tx, actor)),
            id: { in: refs.map((r) => r.recordId) },
            deletedAt: null,
          },
        }),
    );
    if (refs.some((ref) => !latest.some((row) => row.id === ref.recordId)))
      throw new NotFoundException('Capturas no disponibles');
    return {
      data: data.map((item) => {
        const record = latest.find((row) => row.id === item.recordId)!;
        return (item.slot === 'initial'
          ? record.initialFileId
          : record.finalFileId) === item.fileId
          ? item
          : {
              recordId: item.recordId,
              slot: item.slot,
              fileId: item.fileId,
              generation: item.generation,
              status: 'STALE',
            };
      }),
    };
  }

  private async thumbnail(
    client: Awaited<
      ReturnType<ClassSessionRecordsService['context']>
    >['client'],
    actor: SessionActor,
    file: File,
    buffer?: Buffer,
    deadline = Date.now() + 15000,
  ) {
    if (this.thumbnailWork >= 2)
      throw new ServiceUnavailableException(
        'Miniaturas ocupadas; reintente el lote',
      );
    this.thumbnailWork++;
    try {
      return await this.records.transaction(
        client,
        actor.schema,
        async (tx) => {
          const [lock] = await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(hashtextextended(${actor.schema + ':thumbnail:' + file.id},0)) AS locked`;
          if (!lock.locked)
            throw new ServiceUnavailableException('Derivada en preparación');
          const current = await tx.file.findUniqueOrThrow({
            where: { id: file.id },
          });
          let meta = current.thumbnail as {
            objectName: string;
            generation: string;
            sourceGeneration: string;
            width: number;
            height: number;
            checksum: string;
          } | null;
          if (!meta || meta.sourceGeneration !== file.generation) {
            const original = buffer ?? await this.objects.download(
              file.bucket,
              file.objectName,
              file.generation!,
              Math.max(1, deadline - Date.now()),
            );
            if (
              original.length !== file.size ||
              createHash('sha256').update(original).digest('hex') !==
                file.checksum
            )
              throw new Error('Checksum mismatch');
            const { data, info } = await sharp(original, {
              limitInputPixels: 4096 * 4096,
            })
              .resize({
                width: 320,
                height: 320,
                fit: 'inside',
                withoutEnlargement: true,
              })
              .webp({ quality: 75 })
              .timeout({ seconds: 5 })
              .toBuffer({ resolveWithObject: true });
            if (data.length > 256 * 1024)
              throw new Error('Derivada demasiado grande');
            const checksum = createHash('sha256').update(data).digest('hex');
            const objectName = `${file.objectName}.thumbnail-${file.generation}-${randomUUID()}.webp`;
            const generation = await this.objects.upload(
              file.bucket,
              objectName,
              data,
              checksum,
              'image/webp',
              Math.max(1, deadline - Date.now()),
            );
            meta = {
              objectName,
              generation,
              sourceGeneration: file.generation!,
              width: info.width,
              height: info.height,
              checksum,
            };
            await tx.file.update({
              where: { id: file.id },
              data: { thumbnail: json(meta) },
            });
            return {
              contentType: 'image/webp',
              width: info.width,
              height: info.height,
              content: data.toString('base64'),
            };
          }
          const bytes = await this.objects.download(
            file.bucket,
            meta.objectName,
            meta.generation,
            Math.max(1, deadline - Date.now()),
          );
          if (
            bytes.length > 256 * 1024 ||
            createHash('sha256').update(bytes).digest('hex') !== meta.checksum
          )
            throw new Error('Invalid thumbnail');
          return {
            contentType: 'image/webp',
            width: meta.width,
            height: meta.height,
            content: bytes.toString('base64'),
          };
        },
        Math.max(1, deadline - Date.now()),
      );
    } finally {
      this.thumbnailWork--;
    }
  }

  async content(principal: SessionPrincipal, id: string) {
    const { client, actor } = await this.records.context(principal);
    const file = await this.records.transaction(
      client,
      actor.schema,
      async (tx) => {
        const found = await tx.file.findUnique({ where: { id } });
        if (
          !found ||
          found.recordId === null ||
          found.deletedAt ||
          found.status !== 'AVAILABLE' ||
          !found.generation ||
          !found.checksum
        )
          throw new NotFoundException('Archivo no disponible');
        await this.records.lock(tx, found.recordId);
        await this.records.authorizeRecord(
          tx,
          actor,
          found.recordId,
          false,
          true,
        );
        await this.records.audit(
          tx,
          actor,
          found.recordId,
          'FILE_ACCESS_REQUESTED',
          null,
          { fileId: id, generation: found.generation },
        );
        return found;
      },
    );
    try {
      const bytes = await this.objects.download(
        file.bucket,
        file.objectName,
        file.generation!,
      );
      if (
        bytes.length !== file.size ||
        createHash('sha256').update(bytes).digest('hex') !== file.checksum
      )
        throw new Error('Checksum mismatch');
      return { file, bytes };
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo recuperar el archivo íntegro',
      );
    }
  }
}
