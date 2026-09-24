"""Regenerates the PWA icons in /public. Run: python3 scripts/make-icons.py (needs Pillow)."""
from PIL import Image, ImageDraw

INK = (14, 61, 49)        # deep green
PAPER = (243, 245, 240)
SAFFRON = (240, 168, 32)

def draw(size, padding_ratio=0.0, rounded=True):
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=INK)
    else:
        d.rectangle([0, 0, s, s], fill=INK)
    inset = s * (0.20 + padding_ratio)
    tag = [inset, inset * 0.9, s - inset, s - inset * 0.9]
    d.rounded_rectangle(tag, radius=int(s * 0.06), fill=PAPER)
    # QR-ish finder squares
    u = (tag[2] - tag[0]) / 9
    def finder(x, y):
        d.rectangle([x, y, x + 3 * u, y + 3 * u], fill=INK)
        d.rectangle([x + u * 0.6, y + u * 0.6, x + 2.4 * u, y + 2.4 * u], fill=PAPER)
        d.rectangle([x + u * 1.05, y + u * 1.05, x + 1.95 * u, y + 1.95 * u], fill=INK)
    finder(tag[0] + u, tag[1] + u)
    finder(tag[2] - 4 * u, tag[1] + u)
    finder(tag[0] + u, tag[3] - 4 * u)
    # saffron tick
    cx, cy = tag[2] - 3.2 * u, tag[3] - 2.6 * u
    w = int(u * 0.85)
    d.line([(cx - 1.4 * u, cy), (cx - 0.3 * u, cy + 1.0 * u), (cx + 1.6 * u, cy - 1.3 * u)],
           fill=SAFFRON, width=w, joint="curve")
    return img.resize((size, size), Image.LANCZOS)

draw(192).save("public/icon-192.png")
draw(512).save("public/icon-512.png")
draw(512, padding_ratio=0.05, rounded=False).save("public/icon-maskable-512.png")
draw(180, rounded=False).save("public/apple-touch-icon.png")
draw(64).save("public/favicon.png")
print("icons written")
