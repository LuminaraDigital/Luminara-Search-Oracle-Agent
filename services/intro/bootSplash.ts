/**
 * First-paint boot splash helpers (HTML #boot-splash, before/while React mounts).
 */
export function dismissBootSplash(delayMs = 120): void {
  const el = document.getElementById('boot-splash');
  if (!el) return;

  const run = () => {
    el.classList.add('boot-splash--exit');
    el.setAttribute('aria-busy', 'false');
    const remove = () => {
      try { el.remove(); } catch { /* already gone */ }
    };
    el.addEventListener('transitionend', remove, { once: true });
    window.setTimeout(remove, 900);
  };

  if (delayMs <= 0) run();
  else window.setTimeout(run, delayMs);
}
