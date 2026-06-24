"""Genera icone PWA SuperNova Mobile da PNG sorgente (assets/supernova_mobile_icon_source.png)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "mobile-ui" / "public"
SOURCE_CANDIDATES = (
    ROOT / "assets" / "supernova_mobile_icon_source.png",
    OUT / "supernova-icon-source.png",
)
MOBILE_ICO = ROOT / "assets" / "supernova_mobile_icon.ico"
ICO_SIZES = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
C1 = (129, 140, 248)  # #818cf8
C2 = (167, 139, 250)  # #a78bfa


def _gradient_rgb(size: int, x: int, y: int) -> tuple[int, int, int]:
    t = (x / max(size - 1, 1) + y / max(size - 1, 1)) / 2.0
    return (
        int(C1[0] + (C2[0] - C1[0]) * t),
        int(C1[1] + (C2[1] - C1[1]) * t),
        int(C1[2] + (C2[2] - C1[2]) * t),
    )


def make_icon(size: int) -> Image.Image:
    grad = Image.new("RGB", (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            px[x, y] = _gradient_rgb(size, x, y)

    mask = Image.new("L", (size, size), 0)
    draw_m = ImageDraw.Draw(mask)
    margin = int(size * 0.1)
    radius = int(size * 0.22)
    draw_m.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=radius,
        fill=255,
    )

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img.paste(grad, mask=mask)

    draw = ImageDraw.Draw(img)
    font_size = int(size * 0.44)
    font: ImageFont.ImageFont | ImageFont.FreeTypeFont
    for name in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            font = ImageFont.truetype(name, font_size)
            break
        except OSError:
            continue
    else:
        font = ImageFont.load_default()
    draw.text((size / 2, size / 2), "✦", fill=(255, 255, 255, 255), font=font, anchor="mm")
    return img


def _resolve_source_png() -> Path | None:
    for path in SOURCE_CANDIDATES:
        if path.is_file():
            return path
    return None


def _square_crop_rgba(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return im.crop((left, top, left + side, top + side))


def export_from_source_png(source: Path) -> bool:
    """Usa PNG sorgente SuperNova Mobile (mosaico spaziale)."""
    im = _square_crop_rgba(source)
    for size, fname in (
        (180, "apple-touch-icon.png"),
        (192, "pwa-192x192.png"),
        (512, "pwa-512x512.png"),
    ):
        im.resize((size, size), Image.Resampling.LANCZOS).save(
            OUT / fname, format="PNG", optimize=True
        )
        print(f"Wrote {OUT / fname} (from source)")
    MOBILE_ICO.parent.mkdir(parents=True, exist_ok=True)
    im.resize((256, 256), Image.Resampling.LANCZOS).save(
        MOBILE_ICO, format="ICO", sizes=ICO_SIZES
    )
    print(f"Wrote {MOBILE_ICO}")
    return True


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    source = _resolve_source_png()
    if source and export_from_source_png(source):
        print(f"Icona da {source}")
        return
    for size, fname in (
        (180, "apple-touch-icon.png"),
        (192, "pwa-192x192.png"),
        (512, "pwa-512x512.png"),
    ):
        path = OUT / fname
        make_icon(size).save(path, format="PNG", optimize=True)
        print(f"Wrote {path}")
    # SVG fallback (browser tab)
    svg = OUT / "icon.svg"
    svg.write_text(
        """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#818cf8"/><stop offset="100%" stop-color="#a78bfa"/>
  </linearGradient></defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <text x="256" y="290" font-size="220" text-anchor="middle" fill="#fff"
    font-family="system-ui,Segoe UI,sans-serif">✦</text>
</svg>""",
        encoding="utf-8",
    )
    print(f"Wrote {svg}")


if __name__ == "__main__":
    main()
