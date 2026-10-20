/** Same site after one leading www is removed, including a subdomain of that base. */
export function sameSiteHost(a: string, b: string): boolean {
  const left = a.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  const right = b.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (!left || !right) return false;
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}
