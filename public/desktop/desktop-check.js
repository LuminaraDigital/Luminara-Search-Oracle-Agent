(async function () {
  const versionPill = document.getElementById("versionPill");
  const sourcePill = document.getElementById("sourcePill");
  const githubFallback = document.getElementById("githubFallback");
  try {
    const res = await fetch("/api/desktop/latest", { cache: "no-store" });
    if (!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    if (versionPill) {
      versionPill.textContent = data.version ? "Version " + data.version : "Latest release";
    }
    if (sourcePill) {
      sourcePill.textContent = data.mirroredOnR2
        ? "CDN: Cloudflare R2"
        : "CDN: GitHub redirect";
    }
    if (data.githubLatest && githubFallback) {
      githubFallback.href = data.githubLatest;
    }
    if (data.fileName) {
      const downloadBtn = document.getElementById("downloadBtn");
      if (downloadBtn) {
        downloadBtn.setAttribute("download", data.fileName);
      }
    }
  } catch (err) {
    if (versionPill) versionPill.textContent = "Version unavailable";
    if (sourcePill) sourcePill.textContent = "CDN status unknown";
  }
})();
