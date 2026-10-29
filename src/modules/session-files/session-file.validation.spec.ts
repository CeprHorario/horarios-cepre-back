import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import {
  pngFixture,
  uploadFixture,
} from '../../../test/helpers/session-files-fixtures';
import {
  MAX_SESSION_FILE_SIZE,
  validateSessionFile,
} from './session-file.validation';

describe('Session file validation', () => {
  it.each([0, 2, 4, 6])(
    'accepts structurally valid 8-bit PNG color %s',
    (color) => {
      const buffer = pngFixture(2, 2, color);
      expect(
        validateSessionFile(uploadFixture({ buffer, size: buffer.length }))
          .buffer,
      ).toEqual(buffer);
    },
  );
  it.each([
    '../image.png',
    'evil.svg',
    '.hidden.png',
    'a\r\nb.png',
    'a/b.png',
    'a\\b.png',
    `${'a'.repeat(180)}.png`,
  ])('rejects filename %s', (originalname) => {
    expect(() => validateSessionFile(uploadFixture({ originalname }))).toThrow(
      BadRequestException,
    );
  });
  it('rejects missing files, forged MIME, forged length, invalid CRC, trailing bytes and decompression bombs', () => {
    expect(() => validateSessionFile()).toThrow(BadRequestException);
    expect(() =>
      validateSessionFile(uploadFixture({ mimetype: 'image/jpeg' })),
    ).toThrow(BadRequestException);
    expect(() => validateSessionFile(uploadFixture({ size: 1 }))).toThrow(
      BadRequestException,
    );
    const corrupt = pngFixture();
    corrupt[corrupt.length - 1] ^= 1;
    for (const buffer of [
      Buffer.from('<svg/>'),
      corrupt,
      Buffer.concat([pngFixture(), Buffer.from('x')]),
      pngFixture(4097, 1),
      pngFixture(1, 1, 6, 16),
      pngFixture(4096, 4096),
    ]) {
      expect(() =>
        validateSessionFile(uploadFixture({ buffer, size: buffer.length })),
      ).toThrow(BadRequestException);
    }
  });
  it('enforces the byte limit independently of multipart', () => {
    expect(() =>
      validateSessionFile(uploadFixture({ size: MAX_SESSION_FILE_SIZE + 1 })),
    ).toThrow(PayloadTooLargeException);
  });
});
