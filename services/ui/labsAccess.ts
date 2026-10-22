/**
 * Labs / DEV MODE stays off for normal sessions.
 * Dev builds can hide it with luminara_advanced_ui=0.
 * shortcut: the web client has no admin role, so production stays hidden until a server claim exists.
 */
type ViteMeta = ImportMeta & { env?: { DEV?: boolean } };

function viteDev(): boolean {
  return Boolean((import.meta as ViteMeta).env?.DEV);
}

/** The settings checkbox exists only in a dev build. Production has nothing to turn on. */
export function labsToggleVisible(): boolean {
  return viteDev();
}

export function labsVisible(dev = viteDev()): boolean {
  if (!dev) return false;
  try {
    return localStorage.getItem('luminara_advanced_ui') !== '0';
  } catch {
    return true;
  }
}
