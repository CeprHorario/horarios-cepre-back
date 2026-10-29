import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import { createHash } from 'node:crypto';
import { MAX_SESSION_FILE_SIZE } from './session-file.validation';

@Injectable()
export class SessionObjectStorage {
  private readonly storage: Storage;
  constructor(private readonly config: ConfigService) {
    const endpoint = config.get<string>('STORAGE_EMULATOR_HOST');
    this.storage = new Storage({
      projectId: config.get<string>('GOOGLE_CLOUD_PROJECT'),
      ...(endpoint
        ? { apiEndpoint: endpoint, useAuthWithCustomEndpoint: false }
        : {}),
    });
    // SDK 7.16 treats STORAGE_EMULATOR_HOST as a complete JSON API base URL,
    // unlike apiEndpoint. Normalize it without modifying process-wide environment.
    if (endpoint)
      this.storage.baseUrl = `${endpoint.replace(/\/$/, '')}/storage/v1`;
  }

  bucketName() {
    return this.config.getOrThrow<string>('GCS_BUCKET');
  }

  async upload(
    bucket: string,
    objectName: string,
    bytes: Buffer,
    checksum: string,
  ): Promise<string> {
    const object = this.storage.bucket(bucket).file(objectName);
    // SDK checksum-failure cleanup can delete objects. Verify MD5 ourselves; retain all objects on failure.
    await object.save(bytes, {
      resumable: false,
      validation: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: 'image/png',
        cacheControl: 'private, no-store',
        metadata: { sha256: checksum },
      },
    });
    const metadata = object.metadata;
    const generation = metadata.generation;
    if (
      typeof generation !== 'string' ||
      !/^\d+$/.test(generation) ||
      metadata.md5Hash !== createHash('md5').update(bytes).digest('base64')
    ) {
      throw new Error('Storage returned an invalid generation or checksum');
    }
    return generation;
  }

  async download(
    bucket: string,
    objectName: string,
    generation: string,
  ): Promise<Buffer> {
    const stream = this.storage
      .bucket(bucket)
      .file(objectName, { generation })
      .createReadStream({ validation: false });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream as AsyncIterable<unknown>) {
      if (!Buffer.isBuffer(chunk))
        throw new Error('Unexpected storage response');
      const bytes = chunk;
      size += bytes.length;
      if (size > MAX_SESSION_FILE_SIZE) {
        stream.destroy();
        throw new Error('Storage object too large');
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  }
}
