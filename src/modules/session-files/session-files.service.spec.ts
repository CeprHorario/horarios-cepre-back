import {
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ClassSessionRecordsService } from '../class-session-records/class-session-records.service';
import {
  SessionActor,
  SessionPrincipal,
} from '../class-session-records/session.types';
import { uploadFixture } from '../../../test/helpers/session-files-fixtures';
import { SessionFilesService } from './session-files.service';
import { SessionObjectStorage } from './session-object-storage.service';

describe('SessionFilesService', () => {
  const actor: SessionActor = {
    id: 'monitor',
    email: 'monitor@test.invalid',
    origin: 'academic',
    schema: 'academic',
    role: 'monitor' as SessionActor['role'],
  };
  const principal: SessionPrincipal = {
    userId: actor.id,
    email: actor.email,
    role: actor.role,
  };
  const file = uploadFixture();
  const pending = {
    id: 'file-id',
    recordId: 1,
    objectName: 'object',
    bucket: 'bucket',
    uploadedBy: actor,
    generation: null,
    checksum: createHash('sha256').update(file.buffer).digest('hex'),
    size: file.size,
    status: 'PENDING',
  };
  const available = {
    ...pending,
    generation: '99999999999999999999',
    status: 'AVAILABLE',
  };
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([{ id: 'file-id' }])),
    file: {
      create: jest.fn(),
      update: jest.fn<
        Promise<unknown>,
        [{ data: { status: string; generation?: string }; where: unknown }]
      >(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  const client = {
    $transaction: jest.fn((work: (value: typeof tx) => unknown) =>
      Promise.resolve(work(tx)),
    ),
  };
  const records = {
    transaction: jest.fn(
      (
        _client: unknown,
        _schema: string,
        work: (transaction: typeof tx) => unknown,
      ) => Promise.resolve(work(tx)),
    ),
    context: jest.fn(),
    lock: jest.fn(),
    authorizeRecord: jest.fn(),
    assertWritable: jest.fn(),
    audit: jest.fn<
      Promise<void>,
      [unknown, SessionActor, number, string, unknown, unknown]
    >(),
    now: jest.fn(),
    mutate: jest.fn<
      Promise<unknown>,
      [
        SessionPrincipal,
        number,
        number,
        string,
        string | undefined,
        (
          transaction: typeof tx,
          record: object,
          actor: SessionActor,
        ) => Promise<unknown>,
        boolean?,
      ]
    >(),
  };
  const objects = {
    upload: jest.fn(),
    download: jest.fn(),
    bucketName: jest.fn(),
  };
  let service: SessionFilesService;

  beforeEach(() => {
    jest.clearAllMocks();
    records.context.mockResolvedValue({ client, actor, schema: actor.schema });
    records.authorizeRecord.mockResolvedValue({ id: 1 });
    records.assertWritable.mockResolvedValue(undefined);
    records.audit.mockResolvedValue(undefined);
    records.now.mockResolvedValue(new Date());
    records.mutate.mockImplementation(
      (_principal, _id, _version, _action, _reason, change) =>
        change(tx, {}, actor),
    );
    tx.file.create.mockResolvedValue(pending);
    tx.file.update.mockImplementation(({ data }) =>
      Promise.resolve({
        ...pending,
        ...data,
      }),
    );
    tx.file.findFirst.mockResolvedValue(available);
    tx.file.findUnique.mockResolvedValue(available);
    objects.bucketName.mockReturnValue('bucket');
    objects.upload.mockResolvedValue(available.generation);
    objects.download.mockResolvedValue(file.buffer);
    service = new SessionFilesService(
      records as unknown as ClassSessionRecordsService,
      objects as unknown as SessionObjectStorage,
    );
  });

  it('uploads outside DB transactions, reauthorizes and retains the exact generation without mutating the record', async () => {
    const result = await service.upload(principal, 1, file);
    expect(result.generation).toBe(available.generation);
    expect(records.authorizeRecord).toHaveBeenCalledTimes(2);
    expect(records.context).toHaveBeenCalledTimes(2);
    expect(records.mutate).not.toHaveBeenCalled();
    expect(records.audit.mock.calls.map((call) => call[3])).toEqual([
      'FILE_UPLOAD_PENDING',
      'FILE_UPLOAD_AVAILABLE',
    ]);
    expect(tx.file.create.mock.invocationCallOrder[0]).toBeLessThan(
      objects.upload.mock.invocationCallOrder[0],
    );
    expect(objects.upload.mock.invocationCallOrder[0]).toBeLessThan(
      tx.file.update.mock.invocationCallOrder[0],
    );
  });

  it('never touches storage if authorization fails before pending metadata', async () => {
    records.authorizeRecord.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.upload(principal, 1, file)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(objects.upload).not.toHaveBeenCalled();
    expect(tx.file.create).not.toHaveBeenCalled();
  });

  it('records FAILED and audit on storage failure', async () => {
    objects.upload.mockRejectedValueOnce(new Error('storage offline'));
    await expect(service.upload(principal, 1, file)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(tx.file.update).toHaveBeenCalledWith({
      where: { id: pending.id, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    expect(records.audit.mock.calls.at(-1)?.[3]).toBe('FILE_UPLOAD_FAILED');
  });

  it('rechecks the deadline after upload and never marks an expired upload AVAILABLE', async () => {
    records.authorizeRecord
      .mockResolvedValueOnce({ id: 1 })
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(service.upload(principal, 1, file)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(
      tx.file.update.mock.calls.map((call) => call[0].data.status),
    ).toEqual(['FAILED']);
  });

  it('fails closed if runtime routing changes during upload', async () => {
    records.context
      .mockResolvedValueOnce({ client, actor, schema: actor.schema })
      .mockResolvedValueOnce({ client, actor, schema: 'another' });
    await expect(service.upload(principal, 1, file)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(
      tx.file.update.mock.calls.map((call) => call[0].data.status),
    ).toEqual(['FAILED']);
  });

  it('leaves pending non-evidence if finalization and failure persistence both fail', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    tx.file.update.mockRejectedValue(new Error('DB offline'));
    await expect(service.upload(principal, 1, file)).rejects.toThrow(
      'DB offline',
    );
    expect(objects.upload).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalled();
    logger.mockRestore();
  });

  it('associates only an available file from this record and the monitor uploader', async () => {
    await service.associate(principal, 1, 'initial', {
      fileId: 'file-id',
      expectedVersion: 2,
    });
    expect(tx.file.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'file-id',
        recordId: 1,
        status: 'AVAILABLE',
        deletedAt: null,
      },
    });
    expect(records.mutate.mock.calls[0].slice(0, 5)).toEqual([
      principal,
      1,
      2,
      'CAPTURE_ASSOCIATED',
      undefined,
    ]);
    expect(records.mutate.mock.calls[0][6]).toBe(false); // Ordinary route never bypasses the deadline.
    tx.file.findFirst.mockResolvedValueOnce({
      ...available,
      uploadedBy: { ...actor, id: 'other' },
    });
    await expect(
      service.associate(principal, 1, 'final', {
        fileId: 'file-id',
        expectedVersion: 2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    tx.file.findFirst.mockResolvedValueOnce({
      ...available,
      generation: null,
    });
    await expect(
      service.associate(principal, 1, 'final', {
        fileId: 'file-id',
        expectedVersion: 2,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('audits access request before reading, without declaring human attention', async () => {
    await service.content(principal, 'file-id');
    expect(records.authorizeRecord).toHaveBeenCalledWith(
      tx,
      actor,
      1,
      false,
      true,
    );
    expect(records.audit.mock.calls[0][3]).toBe('FILE_ACCESS_REQUESTED');
    expect(records.audit.mock.invocationCallOrder[0]).toBeLessThan(
      objects.download.mock.invocationCallOrder[0],
    );
    expect(objects.download).toHaveBeenCalledWith(
      'bucket',
      'object',
      available.generation,
    );
  });

  it('denies unavailable files and checksum mismatch', async () => {
    tx.file.findUnique.mockResolvedValueOnce(pending);
    await expect(service.content(principal, 'file-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(objects.download).not.toHaveBeenCalled();
    objects.download.mockResolvedValueOnce(Buffer.from('tampered'));
    await expect(service.content(principal, 'file-id')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
