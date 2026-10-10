// Desktop download page: fetch release metadata and update the pills.
// Kept as an external script so the page satisfies `script-src 'self'` (no inline).
(async function () {
  const versionPill = document.getElementById("versionPill");
  const sourcePill = document.getElementById("sourcePill");
  const githubFallback = document.getElementById("githubFallback");
  try {
    const res = await fetch("/api/desktop/latest", { cache: "no-store" });
    if (!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    versionPill.textContent = data.version ? "Version " + data.version : "Latest release";
    sourcePill.textContent = data.mirroredOnR2
      ? "CDN: Cloudflare R2"
      : "CDN: GitHub redirect";
    if (data.githubLatest) githubFallback.href = data.githubLatest;
    if (data.fileName) {
      document.getElementById("downloadBtn").setAttribute("download", data.fileName);
    }
  } catch (err) {
    versionPill.textContent = "Version unavailable";
    sourcePill.textContent = "CDN status unknown";
  }
})();
