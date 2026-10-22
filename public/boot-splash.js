// shortcut: duplicates the hold in services/intro/bootSplash.ts callers, this file runs before the module graph
window.__dismissBootSplash = function() {
  var el = document.getElementById('boot-splash');
  if (el && !el.classList.contains('boot-splash--exit')) {
    el.classList.add('boot-splash--exit');
    el.setAttribute('aria-busy', 'false');
    setTimeout(function() { try { el.remove(); } catch (_e) {} }, 800);
  }
};
var splash = document.getElementById('boot-splash');
if (splash) {
  splash.addEventListener('click', function() { window.__dismissBootSplash(); });
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced) {
    var shift = function(x, y) {
      splash.style.setProperty('--shift-x', x);
      splash.style.setProperty('--shift-y', y);
    };
    splash.addEventListener('pointermove', function(e) {
      var rect = splash.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      shift((((e.clientX - rect.left) / rect.width - 0.5) * 12).toFixed(2) + 'px', (((e.clientY - rect.top) / rect.height - 0.5) * 8).toFixed(2) + 'px');
    });
    window.addEventListener('deviceorientation', function(e) {
      if (typeof e.gamma !== 'number') return;
      var gx = Math.max(-20, Math.min(20, e.gamma)) / 20;
      var gy = Math.max(-20, Math.min(20, (e.beta || 0) - 40)) / 20;
      shift((gx * 12).toFixed(2) + 'px', (gy * 8).toFixed(2) + 'px');
    });
  }
  setTimeout(function() {
    if (!splash.classList.contains('boot-splash--exit')) splash.classList.add('boot-splash--hold');
  }, 300);
}
// Hang cap only. React dismisses on first paint; Slow 3G of the entry graph can exceed a short timer.
setTimeout(window.__dismissBootSplash, 12000);
