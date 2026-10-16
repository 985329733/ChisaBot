# Windows 图标（pc/build/icon.ico + pc/build/icons/chisabot-<哈希>.ico），docs/online-update.md §2.1。
#
# 为什么单独一个脚本：
#   1. 小尺寸（16–48）存成 32 位 BMP（DIB + 透明通道），64 以上存 PNG——这是 Windows 自己的图标格式建议；
#      全是 PNG 的 .ico 在部分资源管理器 / 旧控件的小图标路径上会退回默认图标或用缓存里的旧图。
#   2. 尺寸补全 Windows 缩放会用到的 20 / 40 / 96（125% / 150% / 200% 的小图标、任务栏、开始菜单）。
#   3. 同一份图标再按内容哈希命名一份放进 build/icons/（打包到 resources/icons/）：快捷方式的图标指向这个
#      新文件名，资源管理器的图标缓存里从来没有这个路径，换了图标就一定按新文件读，不会继续显示旧图标。
#
# 用法：pip install pillow && python3 pc/scripts/win-icon.py   （源图 assets/brand/source.webp，裁切和
# assets/brand/generate.py 一致：≤64px 用更紧的脸部裁切，圆角）
import hashlib, io, os, struct, sys
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

PC = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ROOT = os.path.abspath(os.path.join(PC, ".."))
SRC = os.path.join(ROOT, "assets", "brand", "source.webp")
SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
BMP_MAX = 48

src = Image.open(SRC).convert("RGB").crop((0, 6, 786, 702))
OY = 6


def crop(x, y, s):
    return src.crop((x, y - OY, x + s, y - OY + s))


MAIN = crop(10, 14, 600)
FACE = crop(220, 120, 420)


def sized(img, s):
    out = img.resize((s, s), Image.LANCZOS)
    if s <= 64:
        out = ImageEnhance.Contrast(out).enhance(1.08)
        out = ImageEnhance.Color(out).enhance(1.12)
        out = out.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=1))
    return out


def rounded(s, ss=4):
    m = Image.new("L", (s * ss, s * ss), 0)
    r = int(s * ss * (0.225 if s > 32 else 0.18))
    ImageDraw.Draw(m).rounded_rectangle((0, 0, s * ss - 1, s * ss - 1), radius=r, fill=255)
    return m.resize((s, s), Image.LANCZOS)


def frame(s):
    im = sized(FACE if s <= 64 else MAIN, s).convert("RGBA")
    im.putalpha(rounded(s))
    return im


def dib(im):
    """32 位 BMP 图标帧：BITMAPINFOHEADER（高度 ×2）+ 自下而上的 BGRA + 全 0 的 1 位 AND 掩码。"""
    w, h = im.size
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    px = im.tobytes("raw", "BGRA")
    rows = [px[y * w * 4:(y + 1) * w * 4] for y in range(h)]
    xor = b"".join(reversed(rows))
    mask_row = ((w + 31) // 32) * 4
    return header + xor + b"\0" * (mask_row * h)


def png(im):
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def build():
    blobs = []
    for s in SIZES:
        im = frame(s)
        blobs.append((s, dib(im) if s <= BMP_MAX else png(im)))
    out = struct.pack("<HHH", 0, 1, len(blobs))
    offset = 6 + 16 * len(blobs)
    body = b""
    for s, data in blobs:
        out += struct.pack("<BBBBHHII", s if s < 256 else 0, s if s < 256 else 0, 0, 0, 1, 32, len(data), offset + len(body))
        body += data
    return out + body


def main():
    data = build()
    with open(os.path.join(PC, "build", "icon.ico"), "wb") as f:
        f.write(data)
    icons = os.path.join(PC, "build", "icons")
    os.makedirs(icons, exist_ok=True)
    for name in os.listdir(icons):
        if name.endswith(".ico"):
            os.remove(os.path.join(icons, name))
    name = f"chisabot-{hashlib.sha256(data).hexdigest()[:12]}.ico"
    with open(os.path.join(icons, name), "wb") as f:
        f.write(data)
    print(name, len(data))


if __name__ == "__main__":
    sys.exit(main())
