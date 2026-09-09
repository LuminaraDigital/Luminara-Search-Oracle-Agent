/**
 * Build production favicon/app icons from the official Luminara Suite logo.
 * Usage: node scripts/generate-favicons.mjs [source-image]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public');
const brandDir = path.join(outDir, 'brand');

const defaultSrc = path.join(
  process.env.USERPROFILE || '',
  '.cursor/projects/c-Users-lumin-Desktop-Luminara-Search-Oracle-Agent/assets',
  'c__Users_lumin_AppData_Roaming_Cursor_User_workspaceStorage_577dd16e839e2ca6da8a01e6618a0570_images_luminarasuite_logo_-d377f75d-c960-4632-9fc0-0c1aa4506cbd.jpg',
);

const src = path.resolve(process.argv[2] || defaultSrc);
if (!fs.existsSync(src)) {
  console.error('Source logo not found:', src);
  process.exit(1);
}

fs.mkdirSync(brandDir, { recursive: true });
const buf = fs.readFileSync(src);

await sharp(buf).png().toFile(path.join(brandDir, 'luminara-logo.png'));
await sharp(buf).jpeg({ quality: 95 }).toFile(path.join(brandDir, 'luminara-logo.jpg'));

await sharp(buf).resize(512, 512, { fit: 'cover' }).png().toFile(path.join(outDir, 'icon-512.png'));
await sharp(buf).resize(180, 180, { fit: 'cover' }).png().toFile(path.join(outDir, 'icon-180.png'));
await sharp(buf).resize(512, 512, { fit: 'cover' }).png().toFile(path.join(outDir, 'favicon.png'));
await sharp(buf).resize(32, 32, { fit: 'cover' }).png().toFile(path.join(outDir, 'favicon-32.png'));
await sharp(buf).resize(16, 16, { fit: 'cover' }).png().toFile(path.join(outDir, 'favicon-16.png'));

// Keep a tiny SVG pointer for older bookmarks; raster icons are the primary mark.
fs.writeFileSync(
  path.join(outDir, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Luminara Suite">
  <image href="/favicon.png" width="512" height="512" />
</svg>
`,
);

console.log('Wrote brand + favicon assets from', src);
