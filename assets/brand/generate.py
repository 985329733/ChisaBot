# 从 assets/brand/source.webp（品牌头像原图）生成所有图标：网页 favicon / PWA、登录页、PC、Android、desktop/。
# 用法：pip install pillow imagequant && python3 assets/brand/generate.py
import os, sys
import imagequant
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance, ImageOps

R = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(R, "assets", "brand", "source.webp")
src = Image.open(SRC).convert("RGB").crop((0, 6, 786, 702))  # drop the white strip (top) and dark edge (right)
OY = 6

def crop(x, y, s):
    return src.crop((x, y - OY, x + s, y - OY + s))

MAIN = crop(10, 14, 600)      # face + red ribbon + choker, ocean behind
FACE = crop(220, 120, 420)    # tighter, for <= 64 px
WIDE = crop(70, 60, 560)      # adaptive-icon foreground (outer third is masked away)
PWA_MASK = crop(0, 6, 690)    # PWA maskable: face + ribbon inside the 80% safe circle

RIBBON = (212, 32, 44)        # ribbon red, sampled (brightest ribbon tones ~#d4202c)
OCEAN = (102, 180, 212)       # #66b4d4 ocean, sampled from upper-left sea

def sized(img, s):
    out = img.resize((s, s), Image.LANCZOS)
    if s <= 64:
        out = ImageEnhance.Contrast(out).enhance(1.08)
        out = ImageEnhance.Color(out).enhance(1.12)
        out = out.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=1))
    elif s >= 600:
        out = out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=2))
    return out

def pick(s):
    return FACE if s <= 64 else MAIN

def mask_round(s, kind, ss=4):
    m = Image.new("L", (s * ss, s * ss), 0)
    d = ImageDraw.Draw(m)
    if kind == "circle":
        d.ellipse((0, 0, s * ss - 1, s * ss - 1), fill=255)
    else:
        r = int(s * ss * (0.225 if s > 32 else 0.18))
        d.rounded_rectangle((0, 0, s * ss - 1, s * ss - 1), radius=r, fill=255)
    return m.resize((s, s), Image.LANCZOS)

def icon(s, kind="square", img=None):
    base = sized(img or pick(s), s).convert("RGBA")
    if kind == "square":
        return base
    base.putalpha(mask_round(s, kind))
    return base

def save(img, rel, **kw):
    p = os.path.join(R, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    if rel.endswith(".webp"):
        img.save(p, "WEBP", quality=88, method=6)
    elif rel.endswith(".jpg"):
        img.convert("RGB").save(p, "JPEG", quality=88, optimize=True, progressive=True)
    else:
        if img.size[0] >= 128 and img.mode in ("RGB", "RGBA"):
            img = imagequant.quantize_pil_image(img.convert("RGBA"), dithering_level=1.0, max_colors=256, min_quality=70, max_quality=95)
        img.save(p, optimize=True, **kw)
    return p

def ico(rel, sizes, kind):
    imgs = [icon(s, kind) for s in sizes]
    p = os.path.join(R, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    imgs[-1].save(p, format="ICO", sizes=[(s, s) for s in sizes], append_images=imgs[:-1])

# ---- master brand files (repo-wide source of truth) ----
save(sized(MAIN, 1024), "assets/brand/chisabot-logo-1024.png")
save(icon(512, "circle"), "assets/brand/chisabot-logo-round-512.png")
save(icon(512, "rounded"), "assets/brand/chisabot-logo-rounded-512.png")
save(icon(64, "circle"), "assets/brand/chisabot-mark-64.png")
save(icon(256, "circle"), "docs/images/logo.png")

# ---- web app (served from app/dist root by the server, behind the login gateway) ----
ico("app/public/favicon.ico", [16, 32, 48], "rounded")
save(icon(32, "rounded"), "app/public/favicon-32.png")
save(icon(16, "rounded"), "app/public/favicon-16.png")
save(icon(180, "square").convert("RGB"), "app/public/apple-touch-icon.png")
save(icon(192, "square"), "app/public/icon-192.png")
save(icon(512, "square"), "app/public/icon-512.png")
save(icon(96, "circle"), "app/src/assets/brand/chisa-mark.png")
# PWA（DESIGN.md §40）：any = 圆角透明边（Windows/macOS 安装后的应用图标）；maskable = 满版（系统按圆 / 圆角 / 水滴裁切，
# 安全区是中间 80%，用 WIDE 裁切让脸留在安全区里）。
save(icon(192, "rounded"), "app/public/pwa-any-192.png")
save(icon(512, "rounded"), "app/public/pwa-any-512.png")
save(icon(192, "square", PWA_MASK), "app/public/pwa-maskable-192.png")
save(icon(512, "square", PWA_MASK), "app/public/pwa-maskable-512.png")      # sidebar/topbar brand avatar (bundled, hashed)

# ---- login gateway (public, no session needed) ----
ico("deploy/public/auth-web/brand/favicon.ico", [16, 32, 48], "rounded")
save(icon(32, "rounded"), "deploy/public/auth-web/brand/favicon-32.png")
save(icon(180, "square").convert("RGB"), "deploy/public/auth-web/brand/apple-touch-icon.png")
save(icon(288, "circle"), "deploy/public/auth-web/brand/logo.png")

# ---- PC (Electron) ----
save(icon(512, "rounded"), "pc/assets/icon.png")
ico("pc/build/icon.ico", [16, 24, 32, 48, 64, 128, 256], "rounded")
save(icon(192, "circle"), "pc/src/ui/logo.png")   # client login page; copied to Android by sync-login-android.mjs

def tray(kind):
    s = 32
    im = icon(s, "rounded").copy()
    if kind == "offline":
        g = ImageOps.grayscale(im.convert("RGB")).convert("RGBA")
        g = ImageEnhance.Brightness(g).enhance(1.1)
        g.putalpha(im.getchannel("A").point(lambda a: int(a * 0.8)))
        im = g
    big = im.resize((s * 4, s * 4), Image.LANCZOS)
    d = ImageDraw.Draw(big)
    if kind == "online":
        d.ellipse((s * 4 - 58, s * 4 - 58, s * 4 - 2, s * 4 - 2), fill=(255, 255, 255, 255))
        d.ellipse((s * 4 - 50, s * 4 - 50, s * 4 - 10, s * 4 - 10), fill=(34, 197, 94, 255))
    elif kind == "paused":
        d.ellipse((s * 4 - 62, s * 4 - 62, s * 4 - 2, s * 4 - 2), fill=(255, 255, 255, 255))
        d.ellipse((s * 4 - 54, s * 4 - 54, s * 4 - 10, s * 4 - 10), fill=(229, 72, 77, 255))
        d.rectangle((s * 4 - 42, s * 4 - 42, s * 4 - 22, s * 4 - 22), fill=(255, 255, 255, 255))
    return big.resize((s, s), Image.LANCZOS)
for k in ("online", "offline", "paused"):
    save(tray(k), f"pc/assets/tray-{k}.png")

# ---- Android ----
dens = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for name, f in dens.items():
    L = int(48 * f); A = int(108 * f)
    save(icon(L, "rounded"), f"android/app/src/main/res/mipmap-{name}/ic_launcher.png")
    save(icon(L, "circle"), f"android/app/src/main/res/mipmap-{name}/ic_launcher_round.png")
    fg = Image.new("RGBA", (A, A), (0, 0, 0, 0))
    inner = int(A * 80 / 108)  # the 72dp visible area sits inside this, so the photo's edge never shows
    fg.paste(sized(MAIN, inner).convert("RGBA"), ((A - inner) // 2, (A - inner) // 2))
    save(fg, f"android/app/src/main/res/mipmap-{name}/ic_launcher_foreground.png")
    save(Image.new("RGBA", (A, A), OCEAN + (255,)), f"android/app/src/main/res/mipmap-{name}/ic_launcher_background.png")
save(icon(288, "circle"), "android/app/src/main/res/drawable-nodpi/splash_logo.png")

# ---- desktop/ (Tauri, upstream source; replaced so nothing ships the old mark) ----
T = "desktop/src-tauri/icons/"
for s, n in [(32, "32x32.png"), (64, "64x64.png"), (128, "128x128.png"), (256, "128x128@2x.png"), (1024, "icon.png"),
             (30, "Square30x30Logo.png"), (44, "Square44x44Logo.png"), (71, "Square71x71Logo.png"), (89, "Square89x89Logo.png"),
             (107, "Square107x107Logo.png"), (142, "Square142x142Logo.png"), (150, "Square150x150Logo.png"),
             (284, "Square284x284Logo.png"), (310, "Square310x310Logo.png"), (50, "StoreLogo.png")]:
    save(icon(s, "rounded"), T + n)
ico(T + "icon.ico", [16, 24, 32, 48, 64, 128, 256], "rounded")
big = icon(1024, "rounded")
big.save(os.path.join(R, T + "icon.icns"), format="ICNS")
print("ok")
