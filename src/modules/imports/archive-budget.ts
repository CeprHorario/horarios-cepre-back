import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';

// JSZip exposes internalStream at runtime; its type declarations omit this API.
interface ZipStream {
  on(event: 'data', listener: (chunk: Uint8Array) => void): ZipStream;
  on(event: 'error', listener: (error: Error) => void): ZipStream;
  on(event: 'end', listener: () => void): ZipStream;
  pause(): ZipStream;
  resume(): ZipStream;
}

/** Bound actual decompression before ExcelJS materializes cells. No disk extraction. */
export async function checkArchiveBudget(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > 200)
    throw new BadRequestException('Libro con demasiados archivos internos');
  let total = 0,
    cells = 0;
  for (const entry of entries) {
    let size = 0;
    const worksheet = /^xl\/worksheets\/[^/]+\.xml$/.test(entry.name);
    const xmlFile = /\.(xml|rels)$/.test(entry.name);
    const parts: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = (
        entry as JSZip.JSZipObject & {
          internalStream(type: 'uint8array'): ZipStream;
        }
      ).internalStream('uint8array');
      let aborted = false;
      stream
        .on('data', (chunk: Uint8Array) => {
          if (aborted) return;
          size += chunk.length;
          total += chunk.length;
          if (total > 32 * 1024 * 1024 || size > 8 * 1024 * 1024) {
            aborted = true;
            stream.pause();
            reject(
              new BadRequestException(
                'El libro excede el presupuesto de descompresión',
              ),
            );
            return;
          }
          if (xmlFile) parts.push(Buffer.from(chunk));
        })
        .on('error', reject)
        .on('end', resolve)
        .resume();
    });
    const xml = xmlFile ? Buffer.concat(parts).toString('utf8') : '';
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new BadRequestException(
        'El libro no debe contener DTD ni entidades XML',
      );
    if (worksheet) {
      let rows = 0;
      for (const _match of xml.matchAll(/<(?:[\w.-]+:)?c(?=[\s/>])/g)) {
        void _match;
        if (++cells > 250000)
          throw new BadRequestException('Demasiadas celdas en el libro');
      }
      for (const _match of xml.matchAll(/<(?:[\w.-]+:)?row(?=[\s/>])/g)) {
        void _match;
        if (++rows > 10001)
          throw new BadRequestException('Máximo 10000 filas por hoja');
      }
      for (const match of xml.matchAll(
        /<(?:[\w.-]+:)?c\b[^>]*\br\s*=\s*["']([A-Z]+)(\d+)["']/g,
      )) {
        const column = [...match[1]].reduce(
          (n, letter) => n * 26 + letter.charCodeAt(0) - 64,
          0,
        );
        if (Number(match[2]) > 10001 || column > 64 || cells > 250000)
          throw new BadRequestException(
            'Máximo 10000 filas, 64 columnas y 250000 celdas por libro',
          );
      }
      for (const match of xml.matchAll(
        /<(?:[\w.-]+:)?row\b[^>]*\br\s*=\s*["'](\d+)["']/g,
      ))
        if (Number(match[1]) > 10001)
          throw new BadRequestException('Máximo 10000 filas por hoja');
    }
  }
}
