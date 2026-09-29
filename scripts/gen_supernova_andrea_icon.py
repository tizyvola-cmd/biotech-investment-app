"""Build a gray SuperNova icon for the Andrea desktop shortcut."""
from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "SuperNova_Desktop.ico"
OUT_ASSETS = ROOT / "assets" / "SuperNova_Andrea_Desktop.ico"
OUT_CLIENT = ROOT / "client-remote" / "SuperNova-Andrea.ico"
MAIN_CLIENT = ROOT / "client-remote" / "SuperNova.ico"
SIZES = [16, 24, 32, 48, 64, 128, 256]


def load_frames(path: Path) -> list[Image.Image]:
    im = Image.open(path)
    frames: list[Image.Image] = []
    try:
        i = 0
        while True:
            im.seek(i)
            frames.append(im.copy().convert("RGBA"))
            i += 1
    except EOFError:
        pass
    if not frames:
        frames = [Image.open(path).convert("RGBA")]
    return frames


def to_gray(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    r, g, b, a = rgba.split()
    gray = Image.merge("RGB", (r, g, b)).convert("L")
    # Slightly darker so it reads as "second / Andrea" next to the color icon.
    gray = gray.point(lambda p: max(0, int(p * 0.78)))
    return Image.merge("RGBA", (gray, gray, gray, a))


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Missing source icon: {SRC}")

    frames = load_frames(SRC)
    base = max(frames, key=lambda x: x.size[0] * x.size[1])
    icons = [
        to_gray(base.resize((s, s), Image.Resampling.LANCZOS)) for s in SIZES
    ]

    OUT_ASSETS.parent.mkdir(parents=True, exist_ok=True)
    OUT_CLIENT.parent.mkdir(parents=True, exist_ok=True)

    largest = icons[-1]
    largest.save(
        OUT_ASSETS,
        format="ICO",
        sizes=[(s, s) for s in SIZES],
        append_images=icons[:-1],
    )
    shutil.copy2(OUT_ASSETS, OUT_CLIENT)

    if not MAIN_CLIENT.is_file():
        shutil.copy2(SRC, MAIN_CLIENT)

    print(f"wrote {OUT_ASSETS} ({OUT_ASSETS.stat().st_size} bytes)")
    print(f"wrote {OUT_CLIENT} ({OUT_CLIENT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
