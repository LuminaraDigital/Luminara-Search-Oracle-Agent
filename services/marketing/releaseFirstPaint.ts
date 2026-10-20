/** Drops the server-painted hero. Navigation and the first React commit share this. */
export function dismissFirstPaint(): void {
  document.getElementById('lx-first-paint')?.remove();
  document.documentElement.classList.remove('lx-fp-live');
}

/** Remove the server-painted hero once the visitor leaves that URL. */
export function bindFirstPaintDismissal(): void {
  const node = document.getElementById('lx-first-paint');
  if (!node) {
    dismissFirstPaint();
    return;
  }
  const path = node.getAttribute('data-path') || '/';
  let dropped = false;
  const drop = () => {
    if (dropped) return;
    dropped = true;
    dismissFirstPaint();
    window.removeEventListener('popstate', onNav);
  };
  const onNav = () => {
    const now = (location.pathname || '/').replace(/\/+$/, '') || '/';
    if (now !== path) drop();
  };
  window.addEventListener('popstate', onNav);
  const { pushState, replaceState } = history;
  history.pushState = function (data: unknown, unused: string, url?: string | URL | null) {
    pushState.call(history, data, unused, url);
    onNav();
  };
  history.replaceState = function (data: unknown, unused: string, url?: string | URL | null) {
    replaceState.call(history, data, unused, url);
    onNav();
  };
}
