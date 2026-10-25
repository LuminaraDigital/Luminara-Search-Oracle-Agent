/** An absolute http(s) URL: the only kind of address a link built from model or search output may carry. */
export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
