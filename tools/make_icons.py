"""Draws the app icon (fuel pump on a map-pin badge) at the sizes iOS and the web manifest need."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "docs" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

S = 1024  # draw large, then downscale for smooth edges
img = Image.new("RGB", (S, S), "#0f5132")
d = ImageDraw.Draw(img)

# soft diagonal bands for depth
for i in range(0, S * 2, 6):
    shade = int(20 + 18 * (i / (S * 2)))
    d.line([(i, 0), (0, i)], fill=(14, 70 + shade, 48 + shade // 2), width=6)

W = "#ffffff"
A = "#f59f00"
# pump body
d.rounded_rectangle([300, 250, 600, 800], radius=48, fill=W)
d.rounded_rectangle([250, 770, 650, 840], radius=24, fill=W)
# display window
d.rounded_rectangle([355, 320, 545, 470], radius=26, fill=A)
# hose + nozzle
d.rounded_rectangle([600, 360, 680, 400], radius=18, fill=W)
d.rounded_rectangle([660, 360, 710, 700], radius=25, fill=W)
d.rounded_rectangle([700, 330, 780, 380], radius=18, fill=W)
d.rounded_rectangle([740, 300, 790, 560], radius=25, fill=W)
d.rounded_rectangle([600, 660, 710, 710], radius=25, fill=W)
# drop
d.ellipse([405, 560, 495, 650], fill=A)
d.polygon([(450, 505), (410, 590), (490, 590)], fill=A)

for size, name in ((180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")):
    img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
print("icons ok")
