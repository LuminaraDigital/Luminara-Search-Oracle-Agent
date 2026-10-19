/* Promote preloaded stylesheets without an inline handler (CSP is script-src 'self'). */
(function () {
  var nodes = document.querySelectorAll('link[data-defer-css]');
  for (var i = 0; i < nodes.length; i++) {
    var preload = nodes[i];
    var href = preload.getAttribute('href');
    if (!href) continue;
    var sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = href;
    sheet.media = 'print';
    if (preload.hasAttribute('crossorigin')) sheet.crossOrigin = 'anonymous';
    sheet.onload = function () { this.media = 'all'; };
    document.head.appendChild(sheet);
  }
})();
