/**
 * First-paint boot splash (#boot-splash). React calls this after the shell
 * commits. The pre-module script is only the click skip and the hang cap.
 */
export function dismissBootSplash(delayMs = 0): void {
  const el = document.getElementById('boot-splash');
  if (!el || el.classList.contains('boot-splash--exit')) return;

  const run = () => {
    if (el.classList.contains('boot-splash--exit')) return;
    el.classList.add('boot-splash--exit');
    el.setAttribute('aria-busy', 'false');
    const remove = () => {
      try { el.remove(); } catch { /* already gone */ }
    };
    el.addEventListener('transitionend', remove, { once: true });
    // Matches the 0.65s fade, with slack if transitionend never fires.
    setTimeout(remove, 900);
  };

  if (delayMs <= 0) run();
  else setTimeout(run, delayMs);
}
