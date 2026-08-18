export function toCsv(
  rows: Record<string, unknown>[],
  columns: string[],
): string {
  const header = columns.join(',');
  const lines = rows.map((row) =>
    columns.map((col) => csvEscape(row[col])).join(','),
  );
  return [header, ...lines].join('\n');
}

function csvEscape(value: unknown): string {
  const str = toDisplayString(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}
