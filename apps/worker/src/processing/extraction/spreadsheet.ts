import ExcelJS from 'exceljs';
import Papa from 'papaparse';

/** Header row plus this many data rows — never the whole spreadsheet. */
const MAX_DATA_ROWS = 20;

function rowsToText(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => cell.trim()).join(' | '))
    .filter((line) => line.length > 0)
    .join('\n');
}

export async function extractTextFromXlsx(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  // exceljs ships its own `Buffer` ambient type reference that structurally
  // diverges from this monorepo's `@types/node` in some dependency
  // resolutions; the value itself is a plain Node `Buffer` at runtime.
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );

  const firstSheet = workbook.worksheets[0];

  if (!firstSheet) {
    return '';
  }

  const rows: string[][] = [];

  // exceljs rows are 1-indexed; row 1 is the header, rows 2..21 are the
  // first 20 data rows.
  for (let rowNumber = 1; rowNumber <= MAX_DATA_ROWS + 1; rowNumber += 1) {
    const row = firstSheet.getRow(rowNumber);

    if (!row.hasValues) {
      continue;
    }

    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(cell.text ?? '');
    });
    rows.push(cells);
  }

  return rowsToText(rows);
}

export function extractTextFromCsv(buffer: Buffer): string {
  const parsed = Papa.parse<string[]>(buffer.toString('utf-8'), {
    skipEmptyLines: true,
  });

  const rows = parsed.data.slice(0, MAX_DATA_ROWS + 1);
  return rowsToText(rows);
}
