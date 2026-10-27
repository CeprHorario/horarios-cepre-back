import JSZip from 'jszip';
import { checkArchiveBudget } from './archive-budget';

describe('Presupuesto de libros Excel', () => {
  it('rechaza un archivo pequeño que se expande por encima del límite por entrada', async () => {
    const zip = new JSZip();
    zip.file('xl/sharedStrings.xml', Buffer.alloc(9 * 1024 * 1024, 65));
    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
    expect(buffer.length).toBeLessThan(100000);
    await expect(checkArchiveBudget(buffer)).rejects.toThrow('descompresión');
  });
  it.each([
    `<row r='1048576'><c r='A1048576'/></row>`,
    `<row r="1"><c r="XFD1"/></row>`,
  ])('rechaza posiciones enormes antes de crear celdas: %s', async (xml) => {
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', xml);
    await expect(
      checkArchiveBudget(await zip.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toThrow();
  });
});
