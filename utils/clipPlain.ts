/** One line of visible copy, cut on a word and marked when it does not fit. */
export function clipPlain(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (max < 2 || clean.length <= max) return clean;
  const room = max - 1;
  const slice = clean.slice(0, room);
  const space = slice.lastIndexOf(' ');
  const cut = space >= Math.floor(room * 0.6) ? slice.slice(0, space) : slice;
  return `${cut.trimEnd()}…`;
}
