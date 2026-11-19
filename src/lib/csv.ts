/**
 * CSV export with protection against CSV / formula injection: any cell that a
 * spreadsheet would interpret as a formula (=, +, -, @, tab, CR) is prefixed
 * with an apostrophe, so it is shown as text and never executed.
 */

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export type CsvColumn<T> = { header: string; value: (row: T) => unknown };

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  // BOM so Excel opens UTF-8 correctly.
  return `﻿${lines.join('\r\n')}\r\n`;
}
