import { describeEvidence } from './request-evidence';

describe('Descripciones de anexos', () => {
  const files = ['foto.jpg', 'dni.pdf'].map(originalname => ({ originalname, buffer: Buffer.from(originalname) }) as Express.Multer.File);
  it('vincula cada descripción con el archivo correcto sin cambiar sus bytes', () => {
    const described = describeEvidence(files, [' Certificado médico ', 'Copia del DNI']);
    expect(described.map(file => file.originalname)).toEqual(['Certificado médico', 'Copia del DNI']);
    expect(described[0].buffer).toBe(files[0].buffer);
    expect(files[0].originalname).toBe('foto.jpg');
  });
  it.each([['Certificado médico'], ['', 'DNI'], ['a'.repeat(161), 'DNI'], ['Título\nincorrecto', 'DNI']])('rechaza descripciones incompletas o inválidas: %j', (...values) => {
    expect(() => describeEvidence(files, values as string[])).toThrow('Cada anexo');
  });
  it('conserva compatibilidad de clientes anteriores sin descripciones', () => {
    expect(describeEvidence(files)).toBe(files);
  });
});
