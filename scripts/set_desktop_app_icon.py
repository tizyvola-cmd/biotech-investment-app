"""Install SuperNova desktop icon from a square PNG source."""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICO_SIZES = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
PNG_TARGETS = [
    ROOT / "assets" / "supernova_app_icon.png",
    ROOT / "refresh_desktop" / "BiotechRefresh.png",
    ROOT / "desktop-ui" / "public" / "favicon.png",
    ROOT / "desktop-ui" / "public" / "apple-touch-icon.png",
    ROOT / "electron" / "splash-icon.png",
]
ICO_TARGETS = [
    ROOT / "assets" / "supernova_app_icon.ico",
    ROOT / "assets" / "SuperNova_Desktop.ico",
    ROOT / "refresh_desktop" / "BiotechRefresh.ico",
    ROOT / "electron" / "app-icon.ico",
    ROOT / "desktop-ui" / "public" / "favicon.ico",
]


def square_crop_rgba(src: Path) -> Image.Image:
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return im.crop((left, top, left + side, top + side))


def save_png(im: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = im.resize((size, size), Image.Resampling.LANCZOS)
    out.save(path, format="PNG", optimize=True)
    print(f"Wrote {path}")


def save_ico(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, format="ICO", sizes=ICO_SIZES)
    print(f"Wrote {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Set SuperNova desktop app icon from PNG")
    parser.add_argument(
        "--png",
        type=Path,
        required=True,
        help="Source PNG (square or will be center-cropped)",
    )
    args = parser.parse_args()
    src = args.png.resolve()
    if not src.is_file():
        raise SystemExit(f"Source not found: {src}")

    base = square_crop_rgba(src)

    for path in PNG_TARGETS:
        if path.name == "splash-icon.png":
            size = 512
        elif "supernova_app_icon" in path.name:
            size = 512
        elif path.name == "apple-touch-icon.png":
            size = 180
        else:
            size = 256
        save_png(base, path, size)

    for path in ICO_TARGETS:
        save_ico(base, path)

    print("Done — run scripts\\Installa_Refresh_Su_Desktop.bat to refresh Desktop shortcut.")


if __name__ == "__main__":
    main()
