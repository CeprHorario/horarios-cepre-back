import { BadRequestException } from '@nestjs/common';

/** Legacy API clients may omit titles; new forms provide one title per file. */
export function describeEvidence(files: Express.Multer.File[], descriptions?: string[]) {
  if (descriptions === undefined) return files;
  if (descriptions.length !== files.length || descriptions.some(value => typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 160 || /[\r\n\x00-\x1f]/.test(value))) {
    throw new BadRequestException('Cada anexo debe tener una descripción de entre 3 y 160 caracteres y su archivo correspondiente');
  }
  return files.map((file, index) => ({ ...file, originalname: descriptions[index].trim() }));
}
