/** Same site after one leading www is removed. A subdomain matches on a dot, so evilmovida.com.au does not. */
export function sameSiteHost(a: string, b: string): boolean {
  const left = a.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  const right = b.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (!left || !right) return false;
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}
