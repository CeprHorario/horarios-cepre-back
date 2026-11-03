import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PDFDocument, PDFDict, PDFName, StandardFonts, rgb } from 'pdf-lib';
import sharp, { type Metadata } from 'sharp';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import { createHash } from 'node:crypto';
export const MAX_REQUEST_PDF = 2 * 1024 * 1024;
@Injectable()
export class RequestDocuments {
  private readonly storage: Storage;
  constructor(private readonly config: ConfigService) {
    const endpoint = config.get<string>('STORAGE_EMULATOR_HOST');
    this.storage = new Storage({
      projectId: config.get<string>('GOOGLE_CLOUD_PROJECT'),
      ...(endpoint
        ? { apiEndpoint: endpoint, useAuthWithCustomEndpoint: false }
        : {}),
    });
    if (endpoint)
      this.storage.baseUrl = endpoint.replace(/\/$/, '') + '/storage/v1';
  }
  async generate(
    fields: { label: string; value: string }[],
    evidence: Express.Multer.File[],
    compress: boolean,
  ) {
    if (!evidence.length || evidence.length > 5)
      throw new BadRequestException(
        'Adjunta entre una y cinco evidencias PDF, PNG o JPEG',
      );
    if (evidence.reduce((n, f) => n + f.buffer.length, 0) > 10 * 1024 * 1024)
      throw new PayloadTooLargeException(
        'Las evidencias de entrada superan 10 MB',
      );
    const doc = await PDFDocument.create(),
      font = await doc.embedFont(StandardFonts.Helvetica),
      bold = await doc.embedFont(StandardFonts.HelveticaBold);
    let page = doc.addPage([595, 842]),
      y = 770;
    const safe = (s: string) =>
      s.normalize('NFC').replace(/[^\x20-\x7e\xa0-\xff\n]/g, ' ');
    const line = (text: string, heading = false) => {
      if (y < 70) {
        page = doc.addPage([595, 842]);
        y = 780;
      }
      page.drawText(safe(text), {
        x: 45,
        y,
        size: heading ? 13 : 10,
        font: heading ? bold : font,
        color: rgb(0.12, 0.14, 0.25),
      });
      y -= heading ? 25 : 16;
    };
    line('CEPRUNSA - SOLICITUD DE REEMPLAZO', true);
    for (const field of fields) {
      line(field.label.toUpperCase(), true);
      const words = safe(field.value).split(/\s+/);
      let text = '';
      for (const w of words) {
        if (font.widthOfTextAtSize(text + ' ' + w, 10) > 495) {
          line(text);
          text = w;
        } else text += (text ? ' ' : '') + w;
      }
      if (text) line(text);
      y -= 6;
    }
    for (const file of evidence) {
      const bytes = file.buffer;
      if (bytes.subarray(0, 5).toString() === '%PDF-') {
        let source: PDFDocument;
        try {
          source = await PDFDocument.load(bytes, {
            ignoreEncryption: false,
            updateMetadata: false,
          });
        } catch {
          throw new BadRequestException('PDF ilegible, protegido o dañado');
        }
        if (source.getPageCount() > 20 || source.getPageCount() < 1)
          throw new BadRequestException(
            'Cada evidencia PDF admite de 1 a 20 páginas',
          );
        for (const [, object] of source.context.enumerateIndirectObjects())
          if (object instanceof PDFDict) {
            for (const key of [
              'JS',
              'JavaScript',
              'OpenAction',
              'AA',
              'EmbeddedFiles',
              'RichMediaContent',
            ])
              if (object.has(PDFName.of(key)))
                throw new BadRequestException(
                  'La evidencia PDF contiene acciones o archivos incrustados no permitidos',
                );
            const action = object.get(PDFName.of('S'));
            if (
              action?.toString() === '/Launch' ||
              action?.toString() === '/JavaScript'
            )
              throw new BadRequestException('PDF con acciones no permitidas');
          }
        const pages = await doc.copyPages(source, source.getPageIndices());
        pages.forEach((p) => doc.addPage(p));
      } else {
        const image = sharp(bytes, {
          limitInputPixels: 16_000_000,
          failOn: 'error',
        });
        let metadata: Metadata;
        try {
          metadata = await image.metadata();
        } catch {
          throw new BadRequestException(
            'La evidencia no es PDF, PNG o JPEG válido',
          );
        }
        if (!['png', 'jpeg'].includes(metadata.format ?? ''))
          throw new BadRequestException(
            'Solo se aceptan evidencias PDF, PNG o JPEG',
          );
        const optimized = compress
          ? await image
              .rotate()
              .resize({
                width: 1800,
                height: 2400,
                fit: 'inside',
                withoutEnlargement: true,
              })
              .jpeg({ quality: 70, mozjpeg: true })
              .toBuffer()
          : bytes;
        const embedded =
          compress || metadata.format === 'jpeg'
            ? await doc.embedJpg(optimized)
            : await doc.embedPng(optimized);
        const p = doc.addPage([595, 842]),
          scale = Math.min(505 / embedded.width, 720 / embedded.height);
        p.drawText('Evidencia: ' + safe(file.originalname).slice(0, 70), {
          x: 45,
          y: 795,
          size: 10,
          font,
        });
        p.drawImage(embedded, {
          x: (595 - embedded.width * scale) / 2,
          y: 50,
          width: embedded.width * scale,
          height: embedded.height * scale,
        });
      }
    }
    doc.setTitle('Solicitud de reemplazo CEPRUNSA');
    doc.setProducer('CEPRUNSA');
    const bytes = Buffer.from(
      await doc.save({ useObjectStreams: compress, addDefaultPage: false }),
    );
    if (bytes.length > MAX_REQUEST_PDF)
      throw new PayloadTooLargeException(
        'El PDF final supera 2 MB. Activa la compresión o adjunta evidencias más pequeñas; no se ha registrado la solicitud',
      );
    return bytes;
  }
  async upload(schema: string, id: string, bytes: Buffer) {
    const key = `operations/${schema}/${id}.pdf`,
      checksum = createHash('sha256').update(bytes).digest('hex');
    const object = this.storage
      .bucket(this.config.getOrThrow<string>('GCS_BUCKET'))
      .file(key);
    await object.save(bytes, {
      resumable: false,
      validation: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: 'application/pdf',
        cacheControl: 'private, no-store',
        metadata: { sha256: checksum },
      },
    });
    const [metadata] = await object.getMetadata();
    if (metadata.md5Hash !== createHash('md5').update(bytes).digest('base64'))
      throw new BadRequestException(
        'No coincide la integridad del documento almacenado',
      );
    if (!metadata.generation)
      throw new BadRequestException('No se confirmó el documento');
    return {
      key,
      generation: String(metadata.generation),
      checksum,
      size: bytes.length,
    };
  }
  async download(key: string, generation: string, checksum: string) {
    const file = this.storage
      .bucket(this.config.getOrThrow<string>('GCS_BUCKET'))
      .file(key, { generation });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file.createReadStream()) {
      const data = Buffer.from(chunk as Uint8Array);
      size += data.length;
      if (size > MAX_REQUEST_PDF)
        throw new PayloadTooLargeException('Documento inválido');
      chunks.push(data);
    }
    const bytes = Buffer.concat(chunks);
    if (createHash('sha256').update(bytes).digest('hex') !== checksum)
      throw new BadRequestException('No coincide la integridad del documento');
    return bytes;
  }
}
