import { ConfigService } from '@nestjs/config';
import { PDFDocument } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { RequestDocuments, MAX_REQUEST_PDF } from './request-document.service';

describe('Formulario y evidencias de reemplazo', () => {
  it('recupera la generación restaurada solo en el emulador local y exige el mismo contenido', async () => {
    const bytes = Buffer.from('%PDF-local');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const createService = (production = false) => {
      const local = new RequestDocuments(new ConfigService({
        STORAGE_EMULATOR_HOST: 'http://gcs:4443', GCS_BUCKET: 'cepre-records-local',
        NODE_ENV: production ? 'production' : 'development',
      }));
      const file = jest.fn((_key: string, options?: unknown) => ({
        async *createReadStream() {
          if (options) throw Object.assign(new Error('Missing generation'), { code: 404 });
          yield bytes;
        },
      }));
      Object.defineProperty(local, 'storage', { value: { bucket: () => ({ file }) } });
      return { local, file };
    };
    const { local } = createService();
    await expect(local.download('document.pdf', 'old', checksum)).resolves.toEqual(bytes);
    await expect(local.download('document.pdf', 'old', 'wrong')).rejects.toThrow('integridad');
    const production = createService(true);
    await expect(production.local.download('document.pdf', 'old', checksum)).rejects.toThrow('Missing generation');
    expect(production.file).toHaveBeenCalledTimes(1);
  });
  const service = new RequestDocuments(
    new ConfigService({
      GOOGLE_CLOUD_PROJECT: 'local-tests',
      STORAGE_EMULATOR_HOST: 'http://127.0.0.1:4443',
    }),
  );
  const attachment = (buffer: Buffer, mimetype = 'application/pdf') =>
    ({
      buffer,
      mimetype,
      originalname: 'evidencia.pdf',
      size: buffer.length,
    }) as Express.Multer.File;
  it('conserva todas las páginas y añade el formulario sin alterar la evidencia', async () => {
    const evidence = await PDFDocument.create();
    evidence.addPage([300, 400]);
    evidence.addPage([400, 300]);
    const original = Buffer.from(await evidence.save());
    const bytes = await service.generate(
      [{ label: 'Motivo', value: 'Reemplazo documentado de dos bloques' }],
      [attachment(original)],
      true,
    );
    expect(bytes.length).toBeLessThanOrEqual(MAX_REQUEST_PDF);
    const result = await PDFDocument.load(bytes);
    expect(result.getPageCount()).toBe(3);
    expect(result.getPage(1).getSize()).toEqual({ width: 300, height: 400 });
    expect(result.getPage(2).getSize()).toEqual({ width: 400, height: 300 });
    expect(Buffer.from(await evidence.save())).toEqual(original);
  });
  it('rechaza archivos que dicen ser PDF y no pueden leerse', async () => {
    await expect(
      service.generate([], [attachment(Buffer.from('not a PDF'))], false),
    ).rejects.toThrow();
  });
  it('requiere evidencia y limita el total de entrada antes de procesar', async () => {
    await expect(service.generate([], [], false)).rejects.toThrow();
    await expect(
      service.generate(
        [],
        [attachment(Buffer.alloc(10 * 1024 * 1024 + 1))],
        true,
      ),
    ).rejects.toThrow();
  });
  it('rechaza acciones activas dentro de una evidencia PDF', async () => {
    const evidence = await PDFDocument.create();
    evidence.addPage();
    evidence.addJavaScript('script', 'app.alert("x")');
    await expect(
      service.generate(
        [],
        [attachment(Buffer.from(await evidence.save()))],
        false,
      ),
    ).rejects.toThrow();
  });
});
