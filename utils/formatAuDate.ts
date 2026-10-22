const AU_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

/** Australian date, for example 5 Jan 2026. Empty when the value is not a date. */
export function formatAuDate(value: number | Date | string | null | undefined): string {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-AU', AU_DATE).format(date);
}

/** Clock time in Melbourne, for example 9:04 pm. Empty when the value is not a date. */
export function formatAuClock(value: number | Date | string | null | undefined): string {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Australia/Melbourne',
  }).format(date);
}

/** Sydney calendar day as YYYY-MM-DD. Empty when the value is not a date. */
export function formatAuDay(value: number | Date | null | undefined = new Date()): string {
  if (value == null) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
