import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { inflateSync } from 'node:zlib';
import type {} from 'multer';

export const MAX_SESSION_FILE_SIZE = 10 * 1024 * 1024;

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ponytail: static, non-interlaced 8-bit PNG, <=4096px/axis, 4096 chunks, 64MiB decoded.
// Add other formats only with equivalent bounded structural validation (not MIME sniffing).
export function validateSessionFile(
  file?: Express.Multer.File,
): Express.Multer.File {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length)
    throw new BadRequestException('Se requiere una imagen PNG');
  if (
    file.size > MAX_SESSION_FILE_SIZE ||
    file.buffer.length > MAX_SESSION_FILE_SIZE
  )
    throw new PayloadTooLargeException('Máximo 10 MiB');
  if (
    file.size !== file.buffer.length ||
    file.mimetype !== 'image/png' ||
    !/^[\p{L}\p{N} _.-]+\.png$/iu.test(file.originalname) ||
    Buffer.byteLength(file.originalname) > 180 ||
    file.originalname.startsWith('.')
  ) {
    throw new BadRequestException('Nombre, tamaño o MIME de PNG inválido');
  }
  try {
    const bytes = file.buffer;
    if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
      throw new Error();
    let chunks = 0;
    let offset = 8,
      width = 0,
      height = 0,
      channels = 0,
      ended = false,
      imageEnded = false;
    const image: Buffer[] = [];
    const ancillary = new Map([
      ['sRGB', 1],
      ['gAMA', 4],
      ['cHRM', 32],
      ['pHYs', 9],
    ]);
    while (offset < bytes.length) {
      if (++chunks > 4096) throw new Error();
      if (offset + 12 > bytes.length || ended) throw new Error();
      const length = bytes.readUInt32BE(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) throw new Error();
      const type = bytes.toString('latin1', offset + 4, offset + 8);
      if (
        crc32(bytes.subarray(offset + 4, end - 4)) !==
        bytes.readUInt32BE(end - 4)
      )
        throw new Error();
      const data = bytes.subarray(offset + 8, end - 4);
      if (!width && type !== 'IHDR') throw new Error();
      if (type === 'IHDR') {
        if (width || length !== 13) throw new Error();
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[
          data[9]
        ];
        if (
          !width ||
          !height ||
          width > 4096 ||
          height > 4096 ||
          !channels ||
          data[8] !== 8 ||
          data[10] ||
          data[11] ||
          data[12]
        )
          throw new Error();
      } else if (type === 'IDAT') {
        if (imageEnded) throw new Error();
        image.push(data);
      } else if (type === 'IEND') {
        if (length || !image.length) throw new Error();
        ended = true;
      } else {
        if (image.length || ancillary.get(type) !== length) throw new Error();
        ancillary.delete(type);
      }
      if (image.length && type !== 'IDAT') imageEnded = true;
      offset = end;
    }
    const stride = width * channels + 1,
      decodedSize = stride * height;
    if (!ended || !decodedSize || decodedSize > 64 * 1024 * 1024)
      throw new Error();
    const decoded = inflateSync(Buffer.concat(image), {
      maxOutputLength: decodedSize,
    });
    if (decoded.length !== decodedSize) throw new Error();
    for (let row = 0; row < height; row++)
      if (decoded[row * stride] > 4) throw new Error();
  } catch {
    throw new BadRequestException(
      'PNG inválido o formato no admitido (8 bits, sin entrelazado, máximo 4096 px)',
    );
  }
  return file;
}
