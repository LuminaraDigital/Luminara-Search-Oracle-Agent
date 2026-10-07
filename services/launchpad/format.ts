/** Wei string to a short decimal string without floating point. */
export function formatWei(wei: string, maxDecimals = 4): string {
  const s = wei.replace(/^0+(?=\d)/, '');
  const padded = s.padStart(19, '0');
  const whole = padded.slice(0, -18);
  const frac = padded.slice(-18).slice(0, maxDecimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}
