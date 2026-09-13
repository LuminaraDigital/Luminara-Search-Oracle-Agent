#!/usr/bin/env node
/**
 * Mirror the latest Windows desktop installer into R2 so /desktop/windows
 * streams from Cloudflare edge (DESKTOP_RELEASES binding).
 *
 * Usage:
 *   node scripts/mirror-desktop-r2.mjs
 *   node scripts/mirror-desktop-r2.mjs --exe path/to/Luminara-Suite-Setup-1.0.2.exe
 *   node scripts/mirror-desktop-r2.mjs --tag desktop-v1.0.2
 */
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const BUCKET = 'luminara-desktop-releases';
const REPO = 'LuminaraDigital/Luminara-Search-Oracle-Agent';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function wrangler(args) {
  const wranglerBin = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const r = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(`wrangler ${args.join(' ')} failed with exit ${r.status}`);
  }
}

async function download(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'luminara-mirror-desktop-r2', Accept: 'application/octet-stream' },
    redirect: 'follow',
  });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed ${res.status} for ${url}`);
  }
  await pipeline(res.body, createWriteStream(dest));
}

async function resolveGithubExe(tag) {
  const api = tag
    ? `https://api.github.com/repos/${REPO}/releases/tags/${tag}`
    : `https://api.github.com/repos/${REPO}/releases/latest`;
  const res = await fetch(api, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'luminara-mirror-desktop-r2',
    },
  });
  if (!res.ok) throw new Error(`GitHub release API ${res.status}`);
  const data = await res.json();
  const asset = (data.assets || []).find((a) => /\.exe$/i.test(a.name || ''));
  if (!asset?.browser_download_url) {
    throw new Error('No .exe asset on the selected release');
  }
  const yml = (data.assets || []).find((a) => a.name === 'latest.yml');
  return {
    version: String(data.tag_name || '').replace(/^desktop-v/i, '') || null,
    fileName: asset.name,
    exeUrl: asset.browser_download_url,
    ymlUrl: yml?.browser_download_url || null,
    releasedAt: data.published_at || new Date().toISOString(),
  };
}

async function main() {
  const localExe = argValue('--exe');
  const tag = argValue('--tag');
  const work = join(tmpdir(), `luminara-desktop-mirror-${Date.now()}`);
  mkdirSync(work, { recursive: true });

  let fileName;
  let version;
  let releasedAt = new Date().toISOString();
  let exePath;
  let ymlPath = null;

  if (localExe) {
    if (!existsSync(localExe)) throw new Error(`Missing --exe file: ${localExe}`);
    exePath = localExe;
    fileName = basename(localExe);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    version = pkg.version;
    const localYml = join(ROOT, 'release', 'latest.yml');
    if (existsSync(localYml)) ymlPath = localYml;
  } else {
    const gh = await resolveGithubExe(tag);
    version = gh.version;
    fileName = gh.fileName;
    releasedAt = gh.releasedAt;
    exePath = join(work, fileName);
    console.log(`[mirror] Downloading ${gh.exeUrl}`);
    await download(gh.exeUrl, exePath);
    if (gh.ymlUrl) {
      ymlPath = join(work, 'latest.yml');
      await download(gh.ymlUrl, ymlPath);
    }
  }

  const sha512 = createHash('sha512').update(readFileSync(exePath)).digest('base64');
  const manifestPath = join(work, 'manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version,
        fileName,
        sha512,
        releasedAt,
        source: localExe ? 'local' : 'github-mirror',
      },
      null,
      2,
    ),
  );

  console.log(`[mirror] Uploading ${fileName} (v${version}) to r2://${BUCKET}/windows/latest.exe`);
  wrangler([
    'r2',
    'object',
    'put',
    `${BUCKET}/windows/latest.exe`,
    '--file',
    exePath,
    '--content-type',
    'application/octet-stream',
    '--remote',
  ]);

  if (ymlPath) {
    console.log(`[mirror] Uploading latest.yml`);
    wrangler([
      'r2',
      'object',
      'put',
      `${BUCKET}/windows/latest.yml`,
      '--file',
      ymlPath,
      '--content-type',
      'text/yaml',
      '--remote',
    ]);
  }

  console.log(`[mirror] Uploading manifest.json`);
  wrangler([
    'r2',
    'object',
    'put',
    `${BUCKET}/windows/manifest.json`,
    '--file',
    manifestPath,
    '--content-type',
    'application/json',
    '--remote',
  ]);

  console.log('[mirror] Done. After Worker deploy with DESKTOP_RELEASES bound, /api/desktop/latest should report mirroredOnR2: true.');
}

main().catch((err) => {
  console.error('[mirror]', err.message || err);
  process.exit(1);
});
