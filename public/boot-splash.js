// Boot splash dismissal failsafe for Luminara Suite SPA shell.
window.__dismissBootSplash = function() {
  var el = document.getElementById('boot-splash');
  if (el && !el.classList.contains('boot-splash--exit')) {
    el.classList.add('boot-splash--exit');
    el.setAttribute('aria-busy', 'false');
    setTimeout(function() { try { el.remove(); } catch(e){} }, 800);
  }
};
var splash = document.getElementById('boot-splash');
if (splash) {
  splash.addEventListener('click', function() { window.__dismissBootSplash(); });
}
// Failsafe: Automatically dismiss the boot splash if React mounting stalls past 1.5s
setTimeout(window.__dismissBootSplash, 1500);
