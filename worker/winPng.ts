/**
 * 1200x630 PNG for the public win page. Bitmap type, no font file, no KV.
 * shortcut: Cache API holds the bytes per colo, upgrade to R2 if OG fetches stay hot after a revoke.
 */

const WIDTH = 1200;
const HEIGHT = 630;

type Rgb = readonly [number, number, number];

const BG: Rgb = [0x12, 0x10, 0x0a];
const GOLD: Rgb = [0xbf, 0x95, 0x3f];
const INK: Rgb = [0xf1, 0xf1, 0xf1];
const MUTED: Rgb = [0xa8, 0xa8, 0xa8];

/** 5-wide, 7-tall. Each row is five bits, left to right. */
const GLYPHS: Record<string, number[]> = Object.fromEntries(
  `
A 01110 10001 10001 11111 10001 10001 10001
B 11110 10001 10001 11110 10001 10001 11110
C 01110 10001 10000 10000 10000 10001 01110
D 11110 10001 10001 10001 10001 10001 11110
E 11111 10000 10000 11110 10000 10000 11111
F 11111 10000 10000 11110 10000 10000 10000
G 01110 10001 10000 10111 10001 10001 01111
H 10001 10001 10001 11111 10001 10001 10001
I 01110 00100 00100 00100 00100 00100 01110
J 00111 00010 00010 00010 00010 10010 01100
K 10001 10010 10100 11000 10100 10010 10001
L 10000 10000 10000 10000 10000 10000 11111
M 10001 11011 10101 10101 10001 10001 10001
N 10001 11001 10101 10011 10001 10001 10001
O 01110 10001 10001 10001 10001 10001 01110
P 11110 10001 10001 11110 10000 10000 10000
Q 01110 10001 10001 10001 10101 10010 01101
R 11110 10001 10001 11110 10100 10010 10001
S 01111 10000 10000 01110 00001 00001 11110
T 11111 00100 00100 00100 00100 00100 00100
U 10001 10001 10001 10001 10001 10001 01110
V 10001 10001 10001 10001 10001 01010 00100
W 10001 10001 10001 10101 10101 10101 01010
X 10001 10001 01010 00100 01010 10001 10001
Y 10001 10001 01010 00100 00100 00100 00100
Z 11111 00001 00010 00100 01000 10000 11111
0 01110 10001 10011 10101 11001 10001 01110
1 00100 01100 00100 00100 00100 00100 01110
2 01110 10001 00001 00010 00100 01000 11111
3 11110 00001 00001 01110 00001 00001 11110
4 00010 00110 01010 10010 11111 00010 00010
5 11111 10000 10000 11110 00001 00001 11110
6 01110 10000 10000 11110 10001 10001 01110
7 11111 00001 00010 00100 01000 01000 01000
8 01110 10001 10001 01110 10001 10001 01110
9 01110 10001 10001 01111 00001 00001 01110
. 00000 00000 00000 00000 00000 01100 01100
: 00000 01100 01100 00000 01100 01100 00000
/ 00001 00010 00100 00100 00100 01000 10000
`.trim().split('\n').map((line) => {
    const [ch, ...rows] = line.split(' ');
    return [ch, rows.map((row) => Number.parseInt(row, 2))];
  }),
);

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function zlib(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  await writer.write(raw);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

function setPixel(rgb: Uint8Array, x: number, y: number, color: Rgb): void {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const index = (y * WIDTH + x) * 3;
  rgb[index] = color[0];
  rgb[index + 1] = color[1];
  rgb[index + 2] = color[2];
}

function fillRect(rgb: Uint8Array, x: number, y: number, w: number, h: number, color: Rgb): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) setPixel(rgb, x + dx, y + dy, color);
  }
}

function drawGlyph(rgb: Uint8Array, bits: number[], x: number, y: number, scale: number, color: Rgb): void {
  for (let row = 0; row < bits.length; row++) {
    for (let col = 0; col < 5; col++) {
      if (((bits[row] >> (4 - col)) & 1) === 0) continue;
      fillRect(rgb, x + col * scale, y + row * scale, scale, scale, color);
    }
  }
}

function charAdvance(scale: number): number {
  return 6 * scale;
}

function drawText(rgb: Uint8Array, text: string, x: number, y: number, scale: number, color: Rgb): void {
  let cursor = x;
  for (const ch of text) {
    if (ch === ' ') {
      cursor += charAdvance(scale);
      continue;
    }
    const glyph = GLYPHS[ch];
    if (glyph) drawGlyph(rgb, glyph, cursor, y, scale, color);
    cursor += charAdvance(scale);
  }
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

export async function renderWinPng(input: {
  agency: string;
  result: string | null;
  date: string;
  footer: string;
}): Promise<Uint8Array> {
  const rgb = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let i = 0; i < rgb.length; i += 3) {
    rgb[i] = BG[0];
    rgb[i + 1] = BG[1];
    rgb[i + 2] = BG[2];
  }
  fillRect(rgb, 0, 0, 18, HEIGHT, GOLD);
  const blocks: Array<{ text: string; scale: number; color: Rgb }> = [
    { text: 'Luminara Suite', scale: 4, color: GOLD },
    { text: input.agency, scale: 6, color: INK },
  ];
  if (input.result) blocks.push({ text: input.result, scale: 4, color: INK });
  if (input.date) blocks.push({ text: input.date, scale: 4, color: MUTED });
  blocks.push({ text: input.footer, scale: 4, color: GOLD });
  let y = 150;
  for (const block of blocks) {
    const maxChars = Math.max(8, Math.floor((WIDTH - 160) / charAdvance(block.scale)));
    const text = block.text.toLocaleUpperCase('en-AU');
    for (const line of wrap(text, maxChars)) {
      drawText(rgb, line, 72, y, block.scale, block.color);
      y += 7 * block.scale + block.scale * 3;
    }
    y += block.scale * 2;
  }

  const stride = 1 + WIDTH * 3;
  const raw = new Uint8Array(HEIGHT * stride);
  for (let row = 0; row < HEIGHT; row++) {
    const start = row * stride;
    raw[start] = 0;
    raw.set(rgb.subarray(row * WIDTH * 3, (row + 1) * WIDTH * 3), start + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, WIDTH);
  view.setUint32(4, HEIGHT);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', await zlib(raw)), chunk('IEND', new Uint8Array())];
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

export const WIN_PNG_WIDTH = WIDTH;
export const WIN_PNG_HEIGHT = HEIGHT;
