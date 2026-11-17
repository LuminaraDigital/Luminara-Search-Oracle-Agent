#!/usr/bin/env python3
"""Crop and compress white paper screenshots. Masters live in assets/, output in public/."""

import hashlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'assets' / 'marketing' / 'white-paper'
OUT = ROOT / 'public' / 'marketing' / 'white-paper'
GENERATED = ROOT / 'services' / 'marketing' / 'whitePaperImages.generated.ts'

# Measured on the 1920x1200 capture: the white bot card, then the bio band to drop.
TELEGRAM_CARD = (760, 174, 1159, 641)
TELEGRAM_TOP = 226  # logo, name, handle
TELEGRAM_BOTTOM = 326  # Open app / Open in web

SERIF = '/usr/share/fonts/truetype/noto/NotoSerif-Regular.ttf'
SERIF_ITALIC = '/usr/share/fonts/truetype/noto/NotoSerif-Italic.ttf'
SANS = '/usr/share/fonts/truetype/macos/Inter-Medium.ttf'
SANS_REG = '/usr/share/fonts/truetype/macos/Inter-Regular.ttf'


def sha10(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:10]


# 0+ Downloads under the developer name on the 1920x1200 Play capture.
PLAY_INSTALL_COUNT = (300, 332, 500, 402)


def hide_play_install_count(im: Image.Image) -> Image.Image:
    rgb = im.convert('RGB')
    ImageDraw.Draw(rgb).rectangle(PLAY_INSTALL_COUNT, fill=(255, 255, 255))
    return rgb


def drop_browser_chrome(im: Image.Image) -> Image.Image:
    rgb = im.convert('RGB')
    px = rgb.load()
    width, _height = rgb.size
    light = 0
    samples = 0
    for x in range(0, width, 8):
        r, g, b = px[x, 40]
        samples += 1
        if r > 220 and g > 220 and b > 220:
            light += 1
    if samples and light / samples > 0.4:
        return rgb.crop((0, 96, width, rgb.size[1]))
    return rgb


def telegram_card(im: Image.Image) -> Image.Image:
    card = im.convert('RGB').crop(TELEGRAM_CARD)
    px = card.load()
    width, height = card.size
    for y in range(height):
        for x in range(width):
            r, g, b = px[x, y]
            # Wallpaper showing through the rounded corners.
            if g > r + 12 and g > b + 12 and g > 150:
                px[x, y] = (255, 255, 255)
    top = card.crop((0, 0, width, TELEGRAM_TOP))
    bottom = card.crop((0, TELEGRAM_BOTTOM, width, height))
    gap = 20
    out = Image.new('RGB', (width, top.height + gap + bottom.height), (255, 255, 255))
    out.paste(top, (0, 0))
    out.paste(bottom, (0, top.height + gap))
    return out


def encode(im: Image.Image, width: int) -> tuple[bytes, int, int]:
    if im.width != width:
        height = round(im.height * width / im.width)
        frame = im.resize((width, height), Image.Resampling.LANCZOS)
    else:
        frame = im
        height = im.height
    buf = Path('/tmp/wp-encode.webp')
    frame.save(buf, 'WEBP', quality=76, method=6)
    return buf.read_bytes(), frame.width, frame.height


def write_shots() -> dict[str, dict[str, object]]:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*'):
        if old.suffix in {'.webp', '.png'}:
            old.unlink()
    shots: dict[str, dict[str, object]] = {}
    for src in sorted(SRC.glob('*.png')):
        im = Image.open(src)
        if src.name == 'play-listing.png':
            im = hide_play_install_count(im)
        framed = telegram_card(im) if src.name == 'telegram-bot.png' else drop_browser_chrome(im)
        widths = [640, 1280] if framed.width > 1280 else [framed.width]
        variants = []
        for width in widths:
            data, w, h = encode(framed, width)
            name = f'{src.stem}-{w}.{sha10(data)}.webp'
            (OUT / name).write_bytes(data)
            variants.append((name, w, h))
        widest = variants[-1]
        srcset = ', '.join(f'/marketing/white-paper/{name} {w}w' for name, w, _h in variants)
        shots[src.name] = {
            'src': f'/marketing/white-paper/{widest[0]}',
            'srcSet': srcset,
            'width': widest[1],
            'height': widest[2],
        }
    return shots


def write_og() -> str:
    image = Image.new('RGB', (1200, 630), (0, 0, 0))
    draw = ImageDraw.Draw(image)
    gold = (191, 149, 63)
    cream = (252, 246, 186)
    ink = (241, 241, 241)
    draw.line((88, 168, 360, 168), fill=gold, width=2)
    draw.text((88, 112), 'WHITE PAPER', font=ImageFont.truetype(SANS, 22), fill=gold)
    draw.text((88, 196), 'Product and', font=ImageFont.truetype(SERIF, 84), fill=cream)
    draw.text((88, 292), 'methodology.', font=ImageFont.truetype(SERIF_ITALIC, 84), fill=gold)
    draw.text(
        (88, 430),
        'Every number labelled Fact, Estimate or Speculation',
        font=ImageFont.truetype(SANS_REG, 28),
        fill=ink,
    )
    draw.text((88, 548), 'Luminara Suite', font=ImageFont.truetype(SANS, 20), fill=gold)
    # A low gold arc, the same horizon the site uses, kept thin.
    draw.arc((80, 520, 1120, 980), 200, 340, fill=gold, width=2)
    buf = Path('/tmp/wp-og.png')
    image.save(buf, 'PNG', optimize=True)
    data = buf.read_bytes()
    name = f'og.{sha10(data)}.png'
    (OUT / name).write_bytes(data)
    return f'/marketing/white-paper/{name}'


def emit(shots: dict[str, dict[str, object]], og: str) -> None:
    lines = [
        '/** Generated by scripts/build-white-paper-images.py. Do not edit by hand. */',
        f"export const WHITE_PAPER_OG_PATH = '{og}';",
        '',
        'export const WHITE_PAPER_IMAGE_BY_FILE = {',
    ]
    for key, shot in shots.items():
        lines.append(f"  '{key}': {{")
        lines.append(f"    src: '{shot['src']}',")
        lines.append(f"    srcSet: '{shot['srcSet']}',")
        lines.append(f"    width: {shot['width']},")
        lines.append(f"    height: {shot['height']},")
        lines.append('  },')
    lines.append('} as const;')
    lines.append('')
    GENERATED.write_text('\n'.join(lines))


def main() -> None:
    shots = write_shots()
    og = write_og()
    emit(shots, og)
    total = sum(p.stat().st_size for p in OUT.iterdir())
    print(f'wrote {len(list(OUT.iterdir()))} files, {total} bytes, og {og}')


if __name__ == '__main__':
    main()
