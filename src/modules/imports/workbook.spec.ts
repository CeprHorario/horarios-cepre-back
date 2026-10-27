import ExcelJS from 'exceljs';
import { headers, importKind, readImport } from './workbook';

describe('Lectura Excel de disponibilidad', () => {
  it('traduce cabeceras legibles a identificadores internos y rechaza desasignaciones', async () => {
    const rows = await readImport(
      Buffer.from(
        'Correo,Día,Alcance,Turno,Hora Inicio,Hora Fin\na@example.com,Lunes,Todo el día,,,',
      ),
      'test.csv',
      'disponibilidad',
    );
    expect(rows[0].values).toMatchObject({
      correo: 'a@example.com',
      dia: 'Lunes',
      alcance: 'Todo el día',
    });
    expect(() => importKind('desasignaciones')).toThrow('supervisión');
  });
  it('lee la hoja Datos con horas numéricas de Excel, incluida medianoche', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Guia').addRow(['Instrucciones']);
    const sheet = workbook.addWorksheet('Datos');
    sheet.addRow(headers.disponibilidad);
    sheet.addRow(['teacher@example.com', 'Lunes', 'Rango', '', 0, 7 / 24]);
    const rows = await readImport(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'test.xlsx',
      'disponibilidad',
    );
    expect(rows[0].values).toMatchObject({
      hora_inicio: '00:00',
      hora_fin: '07:00',
    });
    expect(rows[0].line).toBe(2);
  });

  it('conserva ceros de DNI en CSV y admite punto y coma', async () => {
    const csv = `${headers.monitores.join(';')}\nB-101;Turno 01;01234567;Ana;Perez;;987654321`;
    const rows = await readImport(Buffer.from(csv), 'test.csv', 'monitores');
    expect(rows[0].values.dni).toBe('01234567');
  });

  it('rechaza fórmulas, encabezados repetidos y JSON inválido', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Datos');
    sheet.addRow(headers.disponibilidad);
    sheet.addRow([
      'teacher@example.com',
      'Lunes',
      { formula: '1/24', result: 1 / 24 },
      '08:00',
    ]);
    await expect(
      readImport(
        Buffer.from(await workbook.xlsx.writeBuffer()),
        'test.xlsx',
        'disponibilidad',
      ),
    ).rejects.toThrow('fórmulas');
    await expect(
      readImport(
        Buffer.from('correo,correo\na,b'),
        'test.csv',
        'disponibilidad',
      ),
    ).rejects.toThrow('repetidos');
    await expect(
      readImport(Buffer.from('{invalid'), 'test.json', 'disponibilidad'),
    ).rejects.toThrow('No se pudo leer');
  });
});
