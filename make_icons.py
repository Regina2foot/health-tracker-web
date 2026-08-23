#!/usr/bin/env python3
"""Generate the PWA icons.

    python3 web/make_icons.py

Writes icon-192.png, icon-512.png and icon-512-maskable.png next to
index.html. Run it again after changing the design; the results are committed
so nobody needs to run it just to deploy.

Written with tkinter and zlib from the standard library rather than Pillow,
for the same reason the desktop app avoids dependencies: nothing here should
need a pip install to build.

The design is a simple upward line on a blue field — the trend chart, which is
what the app is for.
"""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent

BLUE = (37, 99, 235)      # matches --accent and the manifest theme_color
WHITE = (255, 255, 255)


def write_png(path: Path, pixels, size: int):
    """Write RGB pixel rows as a PNG. No encoder needed beyond zlib."""
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0 (None) at the start of each scanline
        for x in range(size):
            raw.extend(pixels[y][x])

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def draw_line(pixels, points, size, thickness, colour):
    """Stroke a polyline through points given in 0..1 coordinates."""
    scaled = [(x * size, y * size) for x, y in points]
    radius = thickness / 2

    for (x1, y1), (x2, y2) in zip(scaled, scaled[1:]):
        dx, dy = x2 - x1, y2 - y1
        length = max((dx * dx + dy * dy) ** 0.5, 1e-6)
        steps = int(length * 2) + 1
        for step in range(steps + 1):
            t = step / steps
            cx, cy = x1 + dx * t, y1 + dy * t
            # Round cap at each sample keeps the joins smooth.
            for py in range(int(cy - radius), int(cy + radius) + 1):
                for px in range(int(cx - radius), int(cx + radius) + 1):
                    if 0 <= px < size and 0 <= py < size:
                        if (px - cx) ** 2 + (py - cy) ** 2 <= radius * radius:
                            pixels[py][px] = colour


def build(size: int, inset: float) -> list:
    """A rising line on a blue field.

    `inset` shrinks the drawing towards the middle. Maskable icons get a
    bigger inset because Android crops them to whatever shape the launcher
    uses, and anything near the edge is lost.
    """
    pixels = [[BLUE for _ in range(size)] for _ in range(size)]

    span = 1 - 2 * inset
    points = [
        (inset + 0.00 * span, inset + 0.74 * span),
        (inset + 0.28 * span, inset + 0.46 * span),
        (inset + 0.52 * span, inset + 0.62 * span),
        (inset + 1.00 * span, inset + 0.18 * span),
    ]
    draw_line(pixels, points, size, max(size * 0.075, 2), WHITE)

    # Dots on the vertices, echoing the chart in the app.
    for x, y in points:
        cx, cy = x * size, y * size
        radius = max(size * 0.055, 2)
        for py in range(int(cy - radius), int(cy + radius) + 1):
            for px in range(int(cx - radius), int(cx + radius) + 1):
                if 0 <= px < size and 0 <= py < size:
                    if (px - cx) ** 2 + (py - cy) ** 2 <= radius * radius:
                        pixels[py][px] = WHITE
    return pixels


def main():
    for name, size, inset in (
        ("icon-192.png", 192, 0.20),
        ("icon-512.png", 512, 0.20),
        # Android may crop a maskable icon to a circle, so keep well clear
        # of the edges: only the middle ~80% is guaranteed visible.
        ("icon-512-maskable.png", 512, 0.28),
    ):
        path = OUT / name
        write_png(path, build(size, inset), size)
        print(f"  {name}  ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
