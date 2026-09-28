#!/usr/bin/env python3
"""Download the CC0 photo textures from Poly Haven and shrink them for the web.

All assets are CC0 (public domain) from https://polyhaven.com, so they are free to use
and need no credit. Run from the repo root:  python3 scripts/fetch_textures.py
Needs Pillow (pip install pillow). Output goes to src/assets/, which is committed,
so the game itself never downloads anything from Poly Haven.
"""

import io
import urllib.request
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "src" / "assets"
BASE = "https://dl.polyhaven.org/file/ph-assets"

# Tileable surfaces: game name -> Poly Haven texture.
SURFACES = {
    "grass": "forrest_ground_01",  # meadow: short grass and soil
    "litter": "forest_leaves_03",  # forest floor covered in dry leaves
    "gravel": "river_small_rocks",  # stream banks
    "cliff": "aerial_rocks_02",  # steep ground: rock with moss between
    "moss": "moss_wood",  # thick green moss (the wood's cracks are removed below)
    "rock": "mossy_rock",  # boulders: grey stone with lichen
    "bark": "tree_bark_03",  # pale, smooth, lichen-spotted, like beech
}


# Colour tweaks toward the fresh, early-summer greens of the reference photos:
# (hue shift in degrees, saturation factor, brightness factor, RGB gain).
GRADE = {
    "grass": (8, 1.2, 1.0, (0.85, 1.05, 0.62)),
    "leaves": (14, 1.05, 1.3, (1.0, 1.0, 1.0)),
    "fern": (6, 1.1, 1.15, (1.0, 1.0, 1.0)),
}


def grade(img: Image.Image, name: str) -> Image.Image:
    if name not in GRADE:
        return img
    dh, ds, dv, gain = GRADE[name]
    alpha = img.getchannel("A") if img.mode == "RGBA" else None
    h, s, v = img.convert("RGB").convert("HSV").split()
    h = h.point(lambda x: (x + round(dh * 256 / 360)) % 256)
    s = s.point(lambda x: min(255, round(x * ds)))
    v = v.point(lambda x: min(255, round(x * dv)))
    out = Image.merge("HSV", (h, s, v)).convert("RGB")
    out = Image.merge("RGB", [c.point(lambda x, g=g: min(255, round(x * g))) for c, g in zip(out.split(), gain)])
    if alpha is not None:
        out.putalpha(alpha)
    return out


def fetch(path: str) -> Image.Image:
    with urllib.request.urlopen(f"{BASE}/{path}") as r:
        return Image.open(io.BytesIO(r.read()))


def save(img: Image.Image, name: str, size: tuple[int, int], quality: int):
    img = grade(img.resize(size, Image.LANCZOS), name.split("_")[0] if name.endswith("diff.webp") else "")
    img.save(OUT / name, "WEBP", quality=quality, method=6)
    print(name, (OUT / name).stat().st_size // 1024, "KB")


def cutouts(model: str, part: str, min_area: int):
    """Split a Poly Haven plant atlas into its separate leaves (RGBA, cropped)."""
    diff = fetch(f"Models/jpg/2k/{model}/{model}{part}_diff_2k.jpg").convert("RGB")
    alpha = fetch(f"Models/jpg/2k/{model}/{model}{part}_alpha_2k.jpg").convert("L")
    diff.putalpha(alpha)
    # Find connected pieces on a quarter-size mask.
    small = alpha.resize((alpha.width // 4, alpha.height // 4))
    w, h = small.size
    px = small.load()
    seen = [[False] * w for _ in range(h)]
    boxes = []
    for y in range(h):
        for x in range(w):
            if seen[y][x] or px[x, y] < 128:
                continue
            q = deque([(x, y)])
            seen[y][x] = True
            x0 = x1 = x
            y0 = y1 = y
            n = 0
            while q:
                cx, cy = q.popleft()
                n += 1
                x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny] >= 128:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            if n >= min_area:
                boxes.append((x0 * 4 - 4, y0 * 4 - 4, x1 * 4 + 8, y1 * 4 + 8, n))
    return diff, boxes


def leaf_atlas():
    """Eight broad leaves, each centred in a 256x256 cell, tip up: a 1024x512 sheet."""
    sheet = Image.new("RGBA", (1024, 512), (0, 0, 0, 0))
    cells = []
    # Heart-shaped leaves (serrated, fresh) and oval leaves.
    for model, part, keep in (("shrub_03", "", 6), ("island_tree_01", "_leaves", 2)):
        img, boxes = cutouts(model, part, 1500)
        # The biggest pieces are whole leaves; thin stalks and flower spikes are small.
        boxes.sort(key=lambda b: -b[4])
        for b in boxes[:keep]:
            cells.append(img.crop(b[:4]))
    for i, leaf in enumerate(cells[:8]):
        leaf.thumbnail((240, 240), Image.LANCZOS)
        cx = (i % 4) * 256 + (256 - leaf.width) // 2
        cy = (i // 4) * 256 + (256 - leaf.height) // 2
        sheet.alpha_composite(leaf, (cx, cy))
    sheet = grade(sheet, "leaves")
    sheet.save(OUT / "leaves.webp", "WEBP", quality=85, method=6)
    print("leaves.webp", (OUT / "leaves.webp").stat().st_size // 1024, "KB")


def fern():
    """One fern frond, stalk at the bottom, on a 128x512 transparent card."""
    img, boxes = cutouts("fern_02", "", 1500)
    boxes.sort(key=lambda b: -b[4])
    frond = img.crop(boxes[0][:4])
    frond.thumbnail((128, 512), Image.LANCZOS)
    card = Image.new("RGBA", (128, 512), (0, 0, 0, 0))
    card.alpha_composite(frond, ((128 - frond.width) // 2, 512 - frond.height))
    card = grade(card, "fern")
    card.save(OUT / "fern.webp", "WEBP", quality=85, method=6)
    print("fern.webp", (OUT / "fern.webp").stat().st_size // 1024, "KB")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, ph in SURFACES.items():
        diff = fetch(f"Textures/jpg/1k/{ph}/{ph}_diff_1k.jpg").convert("RGB")
        nor_src = ph
        if name == "moss":
            # moss_wood grows on planks: close up the long dark cracks between them,
            # and take the bumps from a mossy ground instead of the wood grain.
            closed = diff.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))
            gap = ImageChops.subtract(closed.convert("L"), diff.convert("L"))
            cracks = gap.point(lambda x: 255 if x > 85 else 0).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.5))
            diff = Image.composite(closed.filter(ImageFilter.GaussianBlur(3)), diff, cracks)
            nor_src = "aerial_grass_rock"
        save(diff, f"{name}_diff.webp", (1024, 1024), 80)
        save(fetch(f"Textures/jpg/1k/{nor_src}/{nor_src}_nor_gl_1k.jpg").convert("RGB"), f"{name}_nor.webp", (512, 512), 85)
    leaf_atlas()
    fern()


if __name__ == "__main__":
    main()
