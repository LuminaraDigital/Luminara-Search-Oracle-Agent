/**
 * Desktop installer downloads: prefer R2 mirror, fall back to GitHub Releases.
 * Keys in R2 (when DESKTOP_RELEASES is bound):
 *   windows/latest.exe          current one-click NSIS installer
 *   windows/latest.yml          electron-updater metadata (optional mirror)
 *   windows/manifest.json       { version, fileName, sha512?, releasedAt }
 */

export type DesktopDownloadEnv = {
  DESKTOP_RELEASES?: R2Bucket;
  DESKTOP_GITHUB_REPO?: string;
};

const DEFAULT_REPO = 'LuminaraDigital/Luminara-Search-Oracle-Agent';
const R2_LATEST_EXE = 'windows/latest.exe';
const R2_MANIFEST = 'windows/manifest.json';

type Manifest = {
  version?: string;
  fileName?: string;
  sha512?: string;
  releasedAt?: string;
  source?: string;
};

function repoSlug(env: DesktopDownloadEnv): string {
  return (env.DESKTOP_GITHUB_REPO || DEFAULT_REPO).replace(/^\/+|\/+$/g, '');
}

function githubLatestReleaseUrl(env: DesktopDownloadEnv): string {
  return `https://github.com/${repoSlug(env)}/releases/latest`;
}

async function readManifest(env: DesktopDownloadEnv): Promise<Manifest | null> {
  if (!env.DESKTOP_RELEASES) return null;
  const obj = await env.DESKTOP_RELEASES.get(R2_MANIFEST);
  if (!obj) return null;
  try {
    return (await obj.json()) as Manifest;
  } catch {
    return null;
  }
}

/** JSON for the download page / updater diagnostics. */
export async function desktopLatestJson(env: DesktopDownloadEnv): Promise<Response> {
  const manifest = await readManifest(env);
  const hasR2 = Boolean(env.DESKTOP_RELEASES && (await env.DESKTOP_RELEASES.head(R2_LATEST_EXE)));

  return Response.json(
    {
      platform: 'windows',
      channel: 'stable',
      downloadPath: '/desktop/windows',
      mirroredOnR2: hasR2,
      version: manifest?.version || null,
      fileName: manifest?.fileName || 'Luminara-Suite-Setup.exe',
      githubLatest: githubLatestReleaseUrl(env),
      note: hasR2
        ? 'Served from Cloudflare R2 via /desktop/windows'
        : 'R2 mirror empty or unbound; /desktop/windows redirects to GitHub Releases',
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    },
  );
}

/**
 * Stream the Windows installer from R2, or 302 to GitHub Releases.
 */
export async function desktopWindowsDownload(env: DesktopDownloadEnv, request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (env.DESKTOP_RELEASES) {
    const object = await env.DESKTOP_RELEASES.get(R2_LATEST_EXE);
    if (object) {
      const manifest = await readManifest(env);
      const fileName = manifest?.fileName || 'Luminara-Suite-Setup.exe';
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('Content-Type', 'application/octet-stream');
      headers.set('Content-Disposition', `attachment; filename="${fileName}"`);
      headers.set('Cache-Control', 'public, max-age=300');
      headers.set('X-Luminara-Desktop-Source', 'r2');
      if (manifest?.version) headers.set('X-Luminara-Desktop-Version', manifest.version);
      if (object.httpEtag) headers.set('ETag', object.httpEtag);

      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers });
      }
      return new Response(object.body, { status: 200, headers });
    }
  }

  // Prefer the latest release API asset URL when possible; otherwise the releases page.
  const redirectUrl = await resolveGithubInstallerUrl(env).catch(() => githubLatestReleaseUrl(env));
  return Response.redirect(redirectUrl, 302);
}

async function resolveGithubInstallerUrl(env: DesktopDownloadEnv): Promise<string> {
  const api = `https://api.github.com/repos/${repoSlug(env)}/releases/latest`;
  const res = await fetch(api, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'luminara-suite-worker',
    },
  });
  if (!res.ok) return githubLatestReleaseUrl(env);
  const data = (await res.json()) as {
    assets?: Array<{ name?: string; browser_download_url?: string }>;
    html_url?: string;
  };
  const exe = data.assets?.find((a) => typeof a.name === 'string' && /\.exe$/i.test(a.name) && a.browser_download_url);
  if (exe?.browser_download_url) return exe.browser_download_url;
  return data.html_url || githubLatestReleaseUrl(env);
}
