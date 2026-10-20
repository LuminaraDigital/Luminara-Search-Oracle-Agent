/* Promote preloaded stylesheets without an inline handler (CSP is script-src 'self'). */
(function () {
  var nodes = document.querySelectorAll('link[data-defer-css]');
  var pending = nodes.length;
  function finished() {
    pending -= 1;
    if (pending <= 0) window.dispatchEvent(new Event('luminara-css-ready'));
  }
  for (var i = 0; i < nodes.length; i++) {
    var preload = nodes[i];
    var href = preload.getAttribute('href');
    if (!href) {
      finished();
      continue;
    }
    var sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = href;
    sheet.media = 'print';
    if (preload.hasAttribute('crossorigin')) sheet.crossOrigin = 'anonymous';
    sheet.onload = function () {
      this.media = 'all';
      finished();
    };
    sheet.onerror = finished;
    document.head.appendChild(sheet);
  }
})();
