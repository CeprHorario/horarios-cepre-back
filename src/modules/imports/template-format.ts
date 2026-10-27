import type ExcelJS from 'exceljs';
import { importColumns } from './columns';
import type { ImportKind } from './workbook';

export function formatTemplate(workbook: ExcelJS.Workbook, kind: ImportKind) {
  const columns = importColumns(kind);
  const sheet = workbook.getWorksheet('Datos')!;
  const reference = workbook.addWorksheet('Cabeceras');
  reference.columns = [
    { header: 'Cabecera', key: 'label', width: 25 },
    { header: 'Valor obligatorio', key: 'required', width: 22 },
    { header: 'Cabecera obligatoria', key: 'headerRequired', width: 23 },
    { header: 'Formato aceptado', key: 'format', width: 48 },
    { header: 'Ejemplo', key: 'example', width: 35 },
    { header: 'Descripción', key: 'description', width: 85 },
  ];
  columns.forEach((column, index) => {
    const cell = sheet.getRow(1).getCell(index + 1);
    cell.value = column.label;
    cell.note = `${column.required ? 'VALOR OBLIGATORIO' : 'VALOR OPCIONAL'}\n${column.format}\nEjemplo: ${column.example}\n${column.description}`;
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: column.required ? 'FF661124' : 'FF1C2140' },
    };
    reference.addRow({
      ...column,
      required: column.required ? 'Sí' : 'No; puede quedar vacío',
      headerRequired: column.headerRequired ? 'Sí; conservar columna' : 'No',
    });
    if (column.key === 'horas_maximas') {
      sheet.getColumn(index + 1).numFmt = '0';
      const value = sheet.getRow(2).getCell(index + 1).value;
      if (typeof value === 'string' && /^\d+$/.test(value))
        sheet.getRow(2).getCell(index + 1).value = Number(value);
      sheet.getRow(2).getCell(index + 1).dataValidation = {
        type: 'whole',
        operator: 'between',
        formulae: [1, 100],
        allowBlank: false,
        showErrorMessage: true,
        errorTitle: 'Horas máximas',
        error: 'Escribe un entero entre 1 y 100.',
      };
    }
    if (['dia', 'dedicacion', 'alcance'].includes(column.key)) {
      sheet.getRow(2).getCell(index + 1).dataValidation = {
        type: 'list',
        allowBlank: false,
        showErrorMessage: true,
        formulae: [
          column.key === 'alcance'
            ? '"Rango,Turno completo,Todo el día"'
            : column.key === 'dia'
              ? '"Lunes,Martes,Miércoles,Jueves,Viernes,Sábado,Domingo"'
              : '"Tiempo completo,Medio tiempo,Tiempo libre"',
        ],
        error: 'Selecciona una opción de la lista.',
      };
    }
  });
  for (const worksheet of workbook.worksheets) {
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.getRow(1).height = 34;
    worksheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    worksheet.getRow(1).font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    if (worksheet !== sheet)
      worksheet.getRow(1).eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1C2140' },
        };
      });
    if (worksheet.name !== 'Guia')
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: {
          row: Math.max(worksheet.rowCount, 1),
          column: worksheet.columnCount,
        },
      };
  }
  reference.eachRow((row, number) => {
    if (number === 1) return;
    row.height = 65;
    row.alignment = { vertical: 'top', wrapText: true };
    if (number % 2 === 0)
      row.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF3F4F8' },
        };
      });
  });
  sheet.getRow(2).height = 32;
  sheet.getRow(2).alignment = { vertical: 'middle', wrapText: true };
}
