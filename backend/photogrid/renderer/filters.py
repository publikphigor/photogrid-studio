"""CSS-filter strings → Pillow operations."""

from __future__ import annotations

import re

import numpy as np
from PIL import Image, ImageEnhance, ImageOps

_TOKEN = re.compile(r"([a-z\-]+)\(([^)]+)\)")


def _percent(arg: str, default: float = 1.0) -> float:
    arg = arg.strip()
    if arg.endswith("%"):
        return float(arg[:-1]) / 100.0
    return float(arg) if arg else default


def _deg(arg: str) -> float:
    arg = arg.strip()
    if arg.endswith("deg"):
        return float(arg[:-3])
    return float(arg)


def _grayscale(img: Image.Image, amount: float) -> Image.Image:
    if amount <= 0:
        return img
    gray = ImageOps.grayscale(img.convert("RGB")).convert("RGBA")
    return Image.blend(img, gray, min(1.0, amount))


def _sepia(img: Image.Image, amount: float) -> Image.Image:
    if amount <= 0:
        return img
    arr = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    matrix = np.array(
        [
            [0.393, 0.769, 0.189],
            [0.349, 0.686, 0.168],
            [0.272, 0.534, 0.131],
        ],
        dtype=np.float32,
    )
    sepia_arr = arr @ matrix.T
    blended = arr * (1 - amount) + sepia_arr * amount
    blended = np.clip(blended, 0.0, 1.0)
    out = Image.fromarray((blended * 255).astype(np.uint8), mode="RGB").convert("RGBA")
    out.putalpha(img.split()[-1] if img.mode == "RGBA" else 255)
    return out


def _hue_rotate(img: Image.Image, degrees: float) -> Image.Image:
    if degrees == 0:
        return img
    rgb = img.convert("RGB")
    arr = np.asarray(rgb, dtype=np.float32) / 255.0
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    maxc = np.max(arr, axis=-1)
    minc = np.min(arr, axis=-1)
    v = maxc
    delta = maxc - minc
    s = np.where(maxc > 0, delta / np.where(maxc == 0, 1, maxc), 0)
    rc = np.where(delta == 0, 0, (maxc - r) / np.where(delta == 0, 1, delta))
    gc = np.where(delta == 0, 0, (maxc - g) / np.where(delta == 0, 1, delta))
    bc = np.where(delta == 0, 0, (maxc - b) / np.where(delta == 0, 1, delta))
    h = np.zeros_like(maxc)
    h = np.where(maxc == r, bc - gc, h)
    h = np.where(maxc == g, 2.0 + rc - bc, h)
    h = np.where(maxc == b, 4.0 + gc - rc, h)
    h = (h / 6.0) % 1.0
    h = (h + degrees / 360.0) % 1.0
    i = np.floor(h * 6.0).astype(np.int32)
    f = h * 6.0 - i
    p = v * (1.0 - s)
    q = v * (1.0 - s * f)
    t = v * (1.0 - s * (1.0 - f))
    i_mod = i % 6
    out = np.zeros_like(arr)
    sel = (i_mod == 0)
    out[..., 0] = np.where(sel, v, out[..., 0])
    out[..., 1] = np.where(sel, t, out[..., 1])
    out[..., 2] = np.where(sel, p, out[..., 2])
    sel = (i_mod == 1)
    out[..., 0] = np.where(sel, q, out[..., 0])
    out[..., 1] = np.where(sel, v, out[..., 1])
    out[..., 2] = np.where(sel, p, out[..., 2])
    sel = (i_mod == 2)
    out[..., 0] = np.where(sel, p, out[..., 0])
    out[..., 1] = np.where(sel, v, out[..., 1])
    out[..., 2] = np.where(sel, t, out[..., 2])
    sel = (i_mod == 3)
    out[..., 0] = np.where(sel, p, out[..., 0])
    out[..., 1] = np.where(sel, q, out[..., 1])
    out[..., 2] = np.where(sel, v, out[..., 2])
    sel = (i_mod == 4)
    out[..., 0] = np.where(sel, t, out[..., 0])
    out[..., 1] = np.where(sel, p, out[..., 1])
    out[..., 2] = np.where(sel, v, out[..., 2])
    sel = (i_mod == 5)
    out[..., 0] = np.where(sel, v, out[..., 0])
    out[..., 1] = np.where(sel, p, out[..., 1])
    out[..., 2] = np.where(sel, q, out[..., 2])
    out = (np.clip(out, 0, 1) * 255).astype(np.uint8)
    rgb_out = Image.fromarray(out, mode="RGB").convert("RGBA")
    if img.mode == "RGBA":
        rgb_out.putalpha(img.split()[-1])
    return rgb_out


def apply_css_filter(img: Image.Image, css: str) -> Image.Image:
    """Apply a CSS filter string to ``img`` and return RGBA."""
    if not css or css.strip() == "none":
        return img if img.mode == "RGBA" else img.convert("RGBA")
    out = img if img.mode == "RGBA" else img.convert("RGBA")
    for fn, raw_arg in _TOKEN.findall(css.lower()):
        arg = raw_arg.strip()
        if fn == "grayscale":
            out = _grayscale(out, _percent(arg))
        elif fn == "sepia":
            out = _sepia(out, _percent(arg))
        elif fn == "contrast":
            out = ImageEnhance.Contrast(out).enhance(_percent(arg, 1.0))
        elif fn == "saturate":
            out = ImageEnhance.Color(out).enhance(_percent(arg, 1.0))
        elif fn == "brightness":
            out = ImageEnhance.Brightness(out).enhance(_percent(arg, 1.0))
        elif fn == "hue-rotate":
            out = _hue_rotate(out, _deg(arg))
        elif fn == "invert":
            inv = ImageOps.invert(out.convert("RGB")).convert("RGBA")
            if out.mode == "RGBA":
                inv.putalpha(out.split()[-1])
            amount = _percent(arg, 1.0)
            out = Image.blend(out, inv, min(1.0, max(0.0, amount)))
        elif fn == "blur":
            from PIL import ImageFilter

            radius = float(arg.replace("px", "")) if arg else 0.0
            if radius > 0:
                out = out.filter(ImageFilter.GaussianBlur(radius=radius))
    return out
