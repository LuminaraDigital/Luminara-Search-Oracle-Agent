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
const buildDir = path.join(root, 'build');

const defaultSrc = path.join(brandDir, 'luminara-logo-source.jpg');

const src = path.resolve(process.argv[2] || defaultSrc);
if (!fs.existsSync(src)) {
  console.error('Source logo not found:', src);
  process.exit(1);
}

fs.mkdirSync(brandDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });
const buf = fs.readFileSync(src);

/** Pack raw RGBA buffers into an uncompressed BMP-DIB multi-size ICO. */
function makeBmpFrame(rawRgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight (doubled in ICO for XOR + AND masks)
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount (32-bit RGBA)
  header.writeUInt32LE(0, 16); // biCompression (BI_RGB)
  const rowBytes = size * 4;
  const andRowBytes = Math.ceil(size / 32) * 4;
  const imageSize = (rowBytes + andRowBytes) * size;
  header.writeUInt32LE(imageSize, 20); // biSizeImage

  const xorMask = Buffer.alloc(size * size * 4);
  const andMask = Buffer.alloc(andRowBytes * size, 0);

  // BMP rows are stored bottom-to-top, pixel order BGRA
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const srcIdx = (srcY * size + x) * 4;
      const dstIdx = (y * size + x) * 4;
      const r = rawRgba[srcIdx];
      const g = rawRgba[srcIdx + 1];
      const b = rawRgba[srcIdx + 2];
      const a = rawRgba[srcIdx + 3];
      xorMask[dstIdx] = b;
      xorMask[dstIdx + 1] = g;
      xorMask[dstIdx + 2] = r;
      xorMask[dstIdx + 3] = a;
      if (a < 128) {
        const byteIdx = y * andRowBytes + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        andMask[byteIdx] |= (1 << bitIdx);
      }
    }
  }

  return Buffer.concat([header, xorMask, andMask]);
}

function encodeIco(frames) {
  const count = frames.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = ICO
  header.writeUInt16LE(count, 4);

  const directories = [];
  let offset = 6 + count * 16;
  const bodies = [];

  for (const { size, data } of frames) {
    const dir = Buffer.alloc(16);
    dir[0] = size >= 256 ? 0 : size;
    dir[1] = size >= 256 ? 0 : size;
    dir[2] = 0; // color palette count
    dir[3] = 0; // reserved
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bit count
    dir.writeUInt32LE(data.length, 8); // image size in bytes
    dir.writeUInt32LE(offset, 12); // file offset
    directories.push(dir);
    bodies.push(data);
    offset += data.length;
  }

  return Buffer.concat([header, ...directories, ...bodies]);
}

await sharp(buf).png().toFile(path.join(brandDir, 'luminara-logo.png'));
await sharp(buf).jpeg({ quality: 95 }).toFile(path.join(brandDir, 'luminara-logo.jpg'));

// Sizes adhering to Google Search (multiples of 48px), Apple Touch, Android, and desktop browsers
const sizes = [
  // Google Search multiples (48px square requirement)
  { name: 'favicon-48.png', size: 48, dest: outDir },
  { name: 'favicon-48x48.png', size: 48, dest: outDir },
  { name: 'favicon-96.png', size: 96, dest: outDir },
  { name: 'favicon-96x96.png', size: 96, dest: outDir },
  { name: 'favicon-144.png', size: 144, dest: outDir },
  { name: 'favicon-192.png', size: 192, dest: outDir },
  { name: 'android-chrome-192x192.png', size: 192, dest: outDir },
  { name: 'android-chrome-512x512.png', size: 512, dest: outDir },
  // Apple Touch Icons
  { name: 'apple-touch-icon.png', size: 180, dest: outDir },
  { name: 'apple-touch-icon-precomposed.png', size: 180, dest: outDir },
  { name: 'icon-180.png', size: 180, dest: outDir },
  // Standard desktop & hi-res favicons
  { name: 'favicon-16.png', size: 16, dest: outDir },
  { name: 'favicon-16x16.png', size: 16, dest: outDir },
  { name: 'favicon-32.png', size: 32, dest: outDir },
  { name: 'favicon-32x32.png', size: 32, dest: outDir },
  { name: 'favicon.png', size: 512, dest: outDir },
  { name: 'icon-512.png', size: 512, dest: outDir },
  { name: 'icon.png', size: 512, dest: buildDir },
];

for (const { name, size, dest } of sizes) {
  await sharp(buf)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toFile(path.join(dest, name));
}

// Generate native 32-bit BMP ICO with 16, 32, and 48 frames
const icoFrames = [];
for (const size of [16, 32, 48]) {
  const { data } = await sharp(buf)
    .resize(size, size, { fit: 'cover' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  icoFrames.push({ size, data: makeBmpFrame(data, size) });
}
fs.writeFileSync(path.join(outDir, 'favicon.ico'), encodeIco(icoFrames));

// Keep a tiny SVG pointer for vector-preferring clients
fs.writeFileSync(
  path.join(outDir, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Luminara Suite">
  <image href="/favicon.png" width="512" height="512" />
</svg>
`,
);

// Standard Web App Manifest for mobile browsers & Googlebot
const webManifest = JSON.stringify(
  {
    name: 'Luminara Suite',
    short_name: 'Luminara',
    description: 'AI search and AEO visibility audit suite',
    icons: [
      {
        src: '/favicon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/favicon.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    theme_color: '#0a0a0a',
    background_color: '#000000',
    display: 'standalone',
  },
  null,
  2,
);

fs.writeFileSync(path.join(outDir, 'site.webmanifest'), webManifest);
fs.writeFileSync(path.join(outDir, 'manifest.json'), webManifest);

console.log('Wrote brand + favicon + manifest assets from', src);
