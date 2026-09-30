#!/usr/bin/env python3
"""Download the CC0 photo textures from Poly Haven and shrink them for the web.

All assets are CC0 (public domain) from https://polyhaven.com, so they are free to use
and need no credit. Run from the repo root:  python3 scripts/fetch_textures.py
Needs Pillow (pip install pillow). Output goes to src/assets/, which is committed,
so the game itself never downloads anything from Poly Haven.
"""

import io
import math
import random
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "src" / "assets"
BASE = "https://dl.polyhaven.org/file/ph-assets"

# Tileable surfaces: game name -> Poly Haven texture.
SURFACES = {
    "grass": "forrest_ground_01",  # meadow: short grass and soil
    "litter": "forest_leaves_03",  # forest floor covered in dry leaves
    "gravel": "ganges_river_pebbles",  # stream beds and banks: rounded, many-coloured cobbles
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
    "tufts": (-5, 1.2, 1.3, (0.95, 1.05, 0.9)),
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
    try:
        alpha = fetch(f"Models/jpg/2k/{model}/{model}{part}_alpha_2k.jpg").convert("L")
    except urllib.error.HTTPError:
        # A few atlases have no alpha map and sit on black instead.
        alpha = diff.convert("L").point(lambda v: 255 if v > 14 else 0)
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


def recolor(img: Image.Image, dh: float, ds: float, dv: float) -> Image.Image:
    alpha = img.getchannel("A")
    h, s, v = img.convert("RGB").convert("HSV").split()
    h = h.point(lambda x: (x + round(dh * 256 / 360)) % 256)
    s = s.point(lambda x: min(255, round(x * ds)))
    v = v.point(lambda x: min(255, round(x * dv)))
    out = Image.merge("HSV", (h, s, v)).convert("RGB")
    out.putalpha(alpha)
    return out


def paste(cell: Image.Image, piece: Image.Image, cx: float, cy: float, size: float, angle: float = 0):
    """Paste a cutout so its longest side is `size` px, centred on (cx, cy)."""
    p = piece.copy()
    k = size / max(p.size)
    p = p.resize((max(1, round(p.width * k)), max(1, round(p.height * k))), Image.LANCZOS)
    if angle:
        p = p.rotate(angle, expand=True, resample=Image.BICUBIC)
    cell.alpha_composite(p, (round(cx - p.width / 2), round(cy - p.height / 2)))


def stem(draw: ImageDraw.ImageDraw, x0: float, y0: float, x1: float, y1: float, bend: float, width: int = 3):
    pts = []
    for i in range(13):
        t = i / 12
        pts.append((x0 + (x1 - x0) * t + math.sin(t * math.pi) * bend, y0 + (y1 - y0) * t))
    draw.line(pts, fill=(78, 108, 46, 255), width=width, joint="curve")


def plants():
    """Grass tufts (grass.webp, 8 cells of 256x512) and wildflowers (flowers.webp,
    8 cells of 256x256), all assembled from photographed plant parts."""
    tufts, tb = cutouts("grass_bermuda_01", "", 9)
    grass = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    for i, k in enumerate((0, 1, 4, 5, 11, 12, 13, 14)):
        t = tufts.crop(tb[k][:4])
        t.thumbnail((250, 500), Image.LANCZOS)
        grass.alpha_composite(t, ((i % 4) * 256 + (256 - t.width) // 2, (i // 4) * 512 + 512 - t.height))
    grass = grade(grass, "tufts")
    grass.save(OUT / "grass.webp", "WEBP", quality=85, method=6)
    print("grass.webp", (OUT / "grass.webp").stat().st_size // 1024, "KB")

    def parts(model, idx):
        img, boxes = cutouts(model, "", 9)
        return [img.crop(boxes[i][:4]) for i in idx]

    daisy, = parts("flower_ursinia", (6,))
    buttercups = parts("celandine_01", (5, 6, 7))
    dandelions = parts("dandelion_01", (0, 1))
    dleaves = parts("dandelion_01", (5, 13))
    peri = parts("periwinkle_plant", (10, 15))
    small_leaves = parts("periwinkle_plant", (2, 3, 5, 6, 16))
    clover = parts("shrub_sorrel_01", (0, 1, 4))
    petals = parts("shrub_sorrel_01", (5, 6, 7, 8, 9))
    blades = parts("grass_medium_02", (0, 3, 6, 7))
    white = recolor(daisy, 0, 0.08, 1.35)
    heads = {
        0: [white],
        1: buttercups,
        2: [recolor(p, -50, 0.9, 0.9) for p in peri],
        3: [recolor(p, -95, 1.0, 1.0) for p in peri],
        4: peri,
        5: dandelions,
    }
    size = {0: 58, 1: 44, 2: 50, 3: 44, 4: 54, 5: 60}
    rnd = random.Random(5)
    sheet = Image.new("RGBA", (1024, 512), (0, 0, 0, 0))
    for kind in range(8):
        cell = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        d = ImageDraw.Draw(cell)
        if kind in heads:
            n = 3 if kind != 5 else 2
            if kind == 5:
                for j, lf in enumerate(dleaves):
                    paste(cell, lf, 128 + (j - 0.5) * 70, 225, 110, 90 * (1 if j else -1) + rnd.uniform(-25, 25))
            for j in range(n):
                x = 128 + (j - (n - 1) / 2) * 62 + rnd.uniform(-12, 12)
                y = 40 + rnd.uniform(0, 45)
                stem(d, 128 + rnd.uniform(-10, 10), 256, x, y, rnd.uniform(-18, 18))
                if kind != 5:
                    for _ in range(2):
                        ly = rnd.uniform(y + 60, 230)
                        paste(cell, rnd.choice(small_leaves), x + rnd.choice((-16, 16)), ly, 34, rnd.uniform(-60, 60))
                paste(cell, rnd.choice(heads[kind]), x, y, size[kind] * rnd.uniform(0.85, 1.1), rnd.uniform(-20, 20))
        elif kind == 6:
            # Silver grass: long blades with pale, feathery plumes.
            for j, b in enumerate(blades):
                paste(cell, b, 100 + j * 18, 150, 210, rnd.uniform(-12, 12))
            for j in range(4):
                x = 90 + j * 25 + rnd.uniform(-5, 5)
                stem(d, 128, 256, x, 30, rnd.uniform(-10, 10), 2)
                for f in range(26):
                    t = f / 26
                    fy = 30 + t * 70
                    ang = rnd.uniform(-0.5, 0.5) + (0.4 if f % 2 else -0.4)
                    L = 26 * (1 - t * 0.5)
                    d.line([(x, fy), (x + math.sin(ang) * L, fy + math.cos(ang) * L * 0.6)], fill=(232, 226, 210, 230), width=2)
        else:
            # Clover: a low carpet of three-part leaves and a few pink flowers.
            for j in range(9):
                paste(cell, rnd.choice(clover), rnd.uniform(40, 216), rnd.uniform(170, 235), rnd.uniform(46, 64), rnd.uniform(0, 360))
            for j in range(3):
                x = 60 + j * 68 + rnd.uniform(-10, 10)
                y = rnd.uniform(110, 140)
                stem(d, x, 240, x + rnd.uniform(-8, 8), y, rnd.uniform(-6, 6), 2)
                for q in range(5):
                    a = q * 72 + rnd.uniform(-8, 8)
                    rx = x + math.sin(math.radians(a)) * 9
                    ry = y - math.cos(math.radians(a)) * 9
                    paste(cell, petals[q], rx, ry, 22, -a + 180)
        sheet.alpha_composite(cell, ((kind % 4) * 256, (kind // 4) * 256))
    sheet.save(OUT / "flowers.webp", "WEBP", quality=88, method=6)
    print("flowers.webp", (OUT / "flowers.webp").stat().st_size // 1024, "KB")


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
    plants()


if __name__ == "__main__":
    main()
