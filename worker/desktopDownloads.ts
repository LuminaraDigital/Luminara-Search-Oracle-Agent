/**
 * Desktop installer downloads: prefer R2 mirror, fall back to GitHub Releases.
 * Keys in R2 (when DESKTOP_RELEASES is bound):
 *   windows/latest.exe          current one-click NSIS installer
 *   windows/latest.yml          electron-updater metadata (optional mirror)
 *   windows/manifest.json       { version, fileName, sha512?, releasedAt }
 */

import { recordAnonymousEvent } from './productAnalytics';

export type DesktopDownloadEnv = {
  DESKTOP_RELEASES?: R2Bucket;
  DESKTOP_GITHUB_REPO?: string;
  DB?: D1Database;
};

const DEFAULT_REPO = 'LuminaraDigital/Luminara-Search-Oracle-Agent';
const DEFAULT_FILE_NAME = 'Luminara-Suite-Setup.exe';
const SAFE_RELEASE_FILENAME_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SAFE_VERSION_RE = /^[A-Za-z0-9._+-]{1,64}$/;
const SAFE_REPO_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const R2_LATEST_EXE = 'windows/latest.exe';
const R2_MANIFEST = 'windows/manifest.json';

export function sanitizeReleaseFileName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_FILE_NAME;
  const trimmed = raw.trim();
  if (!SAFE_RELEASE_FILENAME_RE.test(trimmed) || trimmed.includes('..') || trimmed.startsWith('.')) {
    return DEFAULT_FILE_NAME;
  }
  return trimmed;
}

function sanitizeVersionHeader(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return SAFE_VERSION_RE.test(trimmed) ? trimmed : null;
}

type Manifest = {
  version?: string;
  fileName?: string;
  sha512?: string;
  releasedAt?: string;
  source?: string;
};

function repoSlug(env: DesktopDownloadEnv): string {
  const candidate = (env.DESKTOP_GITHUB_REPO || DEFAULT_REPO).replace(/^\/+|\/+$/g, '');
  if (!SAFE_REPO_SLUG_RE.test(candidate) || candidate.includes('..')) {
    return DEFAULT_REPO;
  }
  return candidate;
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
      version: sanitizeVersionHeader(manifest?.version),
      fileName: sanitizeReleaseFileName(manifest?.fileName),
      githubLatest: githubLatestReleaseUrl(env),
      note: hasR2
        ? 'Official download is ready at /desktop/windows'
        : 'The download link opens when you use /desktop/windows',
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
export async function desktopWindowsDownload(
  env: DesktopDownloadEnv,
  request: Request,
  background: (work: Promise<void>) => void = () => undefined,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (request.method === 'GET') {
    background(recordAnonymousEvent(env.DB, 'desktop_download_started', '/desktop/windows'));
  }

  if (env.DESKTOP_RELEASES) {
    const object = await env.DESKTOP_RELEASES.get(R2_LATEST_EXE);
    if (object) {
      const manifest = await readManifest(env);
      const fileName = sanitizeReleaseFileName(manifest?.fileName);
      const version = sanitizeVersionHeader(manifest?.version);
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('Content-Type', 'application/octet-stream');
      headers.set('Content-Disposition', `attachment; filename="${fileName}"`);
      headers.set('Cache-Control', 'public, max-age=300');
      headers.set('X-Luminara-Desktop-Source', 'r2');
      if (version) headers.set('X-Luminara-Desktop-Version', version);
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
