// shortcut: duplicates services/intro/bootSplash.ts, this file runs before the module graph
window.__dismissBootSplash = function() {
  var el = document.getElementById('boot-splash');
  if (el && !el.classList.contains('boot-splash--exit')) {
    el.classList.add('boot-splash--exit');
    el.setAttribute('aria-busy', 'false');
    setTimeout(function() { try { el.remove(); } catch (e) {} }, 800);
  }
};
var splash = document.getElementById('boot-splash');
if (splash) {
  splash.addEventListener('click', function() { window.__dismissBootSplash(); });
}
// Hang cap only. React dismisses on first paint; Slow 3G of the entry graph can exceed a short timer.
setTimeout(window.__dismissBootSplash, 12000);
