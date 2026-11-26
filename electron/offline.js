document.getElementById('retry-btn')?.addEventListener('click', () => {
  if (window.luminaraDesktop?.retryConnection) {
    window.luminaraDesktop.retryConnection();
  } else {
    window.location.reload();
  }
});
