/**
 * Cells that a spreadsheet would execute rather than display.
 *
 * Excel and Sheets treat a leading `=`, `+`, `-`, `@`, tab or carriage return
 * as the start of a formula. Every value in an admin export is attacker-shaped
 * somewhere — a `userId`, an external reference, a failure reason copied from a
 * provider — so the cell is prefixed with an apostrophe, which the spreadsheet
 * strips on display and never evaluates.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Render one value as a CSV cell: quoted when it must be, never executable. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;

  // A quote inside a quoted field is doubled; anything containing a delimiter,
  // a quote or a newline has to be quoted or it becomes extra columns.
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}

/**
 * A complete CSV document, CRLF-terminated per RFC 4180 and prefixed with a
 * byte-order mark: without it Excel reads UTF-8 as the local codepage and every
 * Cyrillic product name in the file arrives as mojibake.
 */
export function toCsv(headers: string[], rows: unknown[][]): string {
  return '﻿' + [csvRow(headers), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}
