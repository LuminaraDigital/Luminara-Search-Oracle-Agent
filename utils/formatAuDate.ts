const AU_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

/** Australian date, for example 5 Jan 2026. Empty when the value is not a date. */
export function formatAuDate(value: number | Date | string | null | undefined): string {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-AU', AU_DATE).format(date);
}
