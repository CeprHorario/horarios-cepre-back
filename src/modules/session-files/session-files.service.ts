import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { File } from '../../generated/prisma/client';
import { createHash } from 'node:crypto';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { ClassSessionRecordsService } from '../class-session-records/class-session-records.service';
import {
  json,
  SessionActor,
  SessionPrincipal,
} from '../class-session-records/session.types';
import { AssociateSessionCaptureDto } from './session-files.dto';
import { validateSessionFile } from './session-file.validation';
import { SessionObjectStorage } from './session-object-storage.service';

@Injectable()
export class SessionFilesService {
  private readonly logger = new Logger(SessionFilesService.name);
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
    if (administrative) {
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
        );
        if (administrative)
          await tx.$queryRaw`SELECT set_config('cepr.session_override','true',true)`;
        else await this.records.assertWritable(tx, actor, record);
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
      return await this.records.transaction(client, schema, async (tx) => {
        await this.records.lock(tx, recordId);
        const record = await this.records.authorizeRecord(
          tx,
          current.actor,
          recordId,
          !administrative,
        );
        if (administrative) {
          this.records.admin(current.actor);
          await tx.$queryRaw`SELECT set_config('cepr.session_override','true',true)`;
        } else await this.records.assertWritable(tx, current.actor, record);
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
          (actor.role as Role) === Role.MONITOR &&
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
