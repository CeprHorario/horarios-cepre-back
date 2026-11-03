import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import { PDFDocument } from 'pdf-lib';
import { RequestDocuments } from '../src/modules/operations/request-document.service';
const suite =
  process.env.TEST_DATABASE_URL && process.env.STORAGE_EMULATOR_HOST
    ? describe
    : describe.skip;
suite('PDF de solicitud privado y con versión', () => {
  it('almacena con integridad y rechaza sobrescribir una versión existente', async () => {
    const endpoint = process.env.STORAGE_EMULATOR_HOST!,
      bucket = process.env.GCS_BUCKET!;
    const storage = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
      apiEndpoint: endpoint,
      useAuthWithCustomEndpoint: false,
    });
    storage.baseUrl = endpoint.replace(/\/$/, '') + '/storage/v1';
    try {
      await storage.createBucket(bucket);
    } catch (error) {
      if ((error as { code?: number }).code !== 409) throw error;
    }
    const documents = new RequestDocuments(new ConfigService(process.env));
    const source = await PDFDocument.create();
    source.addPage([300, 400]);
    const evidence = Buffer.from(await source.save());
    const bytes = await documents.generate(
      [{ label: 'Motivo', value: 'Prueba de documento con evidencia' }],
      [
        {
          buffer: evidence,
          size: evidence.length,
          originalname: 'evidencia.pdf',
          mimetype: 'application/pdf',
        } as Express.Multer.File,
      ],
      true,
    );
    const id = randomUUID();
    const stored = await documents.upload('test_operations', id, bytes);
    try {
      expect(
        await documents.download(
          stored.key,
          stored.generation,
          stored.checksum,
        ),
      ).toEqual(bytes);
      await expect(
        documents.upload('test_operations', id, bytes),
      ).rejects.toThrow();
      await expect(
        documents.download(stored.key, stored.generation, '0'.repeat(64)),
      ).rejects.toThrow('integridad');
    } finally {
      await storage
        .bucket(bucket)
        .file(stored.key, { generation: stored.generation })
        .delete({ ifGenerationMatch: stored.generation });
    }
  }, 30000);
});
