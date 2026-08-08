#!/usr/bin/env python3
"""
extract_figures.py — 从真题 PDF 中提取题目配图。

目标:把"原题里的图"原样取出来,落到 public/images/questions/<name>.png,
      题干里用 ![图](/images/questions/<name>.png) 引用(renderRich 已支持)。

两种后端:
  1. PyMuPDF(优先):能直接拿到内嵌图 XObject 的精确坐标框(get_image_rects),
     也能整页高 DPI 栅格化(用于矢量绘制的图 -> 办法二)。
  2. 纯 pypdf(兜底,无原生依赖):扫描 /Resources//XObject 列出内嵌图元信息,
     并用内容流 cm 矩阵算坐标;仅 DCTDecode/JPXDecode 能直接存原始字节,
     其余(FlateDecode 等)需 Pillow/PyMuPDF 编码,本地沙箱装不了原生包时标记 deferred。

本脚本与刷题系统的 roguelike 模块完全无关,仅作用于导入/数据层。

用法:
  python3 extract_figures.py <pdf_or_dir> [--out DIR] [--dpi 300] [--manifest JSON] [--raster-pages]
"""
import sys
import os
import re
import json
import argparse


# ----------------------------------------------------------------------------
# 后端探测
# ----------------------------------------------------------------------------
try:
    import pymupdf as fitz  # 新包名
    HAS_PYMUPDF = True
except Exception:
    HAS_PYMUPDF = False

from pypdf import PdfReader  # 纯 Python,必然可用


# ----------------------------------------------------------------------------
# 纯 pypdf:内容流扫描算坐标
# ----------------------------------------------------------------------------
_NUM_RE = re.compile(rb'^-?\d+(\.\d+)?$')


def _strip_string_literals(data: bytes) -> bytes:
    """去掉 ( ) 与 < > 字符串字面量,避免其中的 cm/Do 干扰算子识别。"""
    out = bytearray()
    i, n = 0, len(data)
    while i < n:
        c = data[i:i + 1]
        if c == b'(':
            depth = 1
            j = i + 1
            while j < n and depth > 0:
                if data[j:j + 1] == b'\\':
                    j += 2
                    continue
                if data[j:j + 1] == b'(':
                    depth += 1
                elif data[j:j + 1] == b')':
                    depth -= 1
                j += 1
            i = j
            continue
        if c == b'<':
            j = data.find(b'>', i)
            i = (n if j == -1 else j + 1)
            continue
        out += c
        i += 1
    return bytes(out)


def _content_bytes(page) -> bytes:
    contents = page.get_contents()
    if isinstance(contents, list):
        return b"".join(c.get_data() for c in contents)
    try:
        return contents.get_data()
    except Exception:
        return bytes(contents)


def _image_names(page):
    """返回 {xobject_name: (xref, obj)} 仅含 /Subtype == /Image。"""
    res = page.get("/Resources")
    names = {}
    if res is None:
        return names
    xobj = res.get("/XObject")
    if xobj is None:
        return names
    for name in xobj:
        obj = xobj[name]
        if obj.get("/Subtype") == "/Image":
            xref = obj.indirect_reference.idnum if obj.indirect_reference else None
            names[name] = (xref, obj)
    return names


def _scan_coords(page, image_names):
    """扫内容流,对每个图像 XObject 返回 PDF 用户坐标框(y 向上)。"""
    data = _strip_string_literals(_content_bytes(page))
    tokens = re.split(rb'\s+', data)
    tokens = [t for t in tokens if t]

    ctm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]  # a,b,c,d,e,f
    stack = []
    pending = []  # 紧邻当前算子的数字缓冲,遇非数字算子即清空
    last_name = None
    boxes = {}

    for tok in tokens:
        if _NUM_RE.match(tok):
            pending.append(float(tok))
            continue
        if tok.startswith(b'/'):
            last_name = tok.decode("latin-1")
            continue
        if tok == b'cm':
            # cm 仅消费其紧邻的 6 个数字(文本定位等其它算子已清空 pending)
            if len(pending) >= 6:
                a, b, c, d, e, f = pending[-6:]  # M_cm
                A, B, C, D, E, F = ctm            # M_old
                # PDF 规范:新 CTM = M_old × M_cm
                ctm = [
                    A * a + C * b, B * a + D * b,
                    A * c + C * d, B * c + D * d,
                    A * e + C * f + E, B * e + D * f + F,
                ]
            pending = []
            last_name = None
            continue
        if tok == b'q':
            stack.append(list(ctm))
            pending = []
            continue
        if tok == b'Q' and stack:
            ctm = stack.pop()
            pending = []
            last_name = None
            continue
        if tok == b'Do' and last_name in image_names:
            # 单位方 [0,1]x[0,1] 经 ctm 变换后的四角
            a, b, c, d, e, f = ctm
            xs = [e, a + e, c + e, a + c + e]
            ys = [f, b + f, d + f, b + d + f]
            boxes[last_name] = (
                min(xs), min(ys), max(xs), max(ys)
            )  # x0,y0,x1,y1 (y-up)
            last_name = None
            pending = []
            continue
        # 其它算子:清空数字缓冲与 last_name
        pending = []
        last_name = None
    return boxes


# ----------------------------------------------------------------------------
# 纯 pypdf 后端
# ----------------------------------------------------------------------------
def _filter_ext(obj):
    f = obj.get("/Filter")
    fk = str(f)
    if "/DCTDecode" in fk:
        return "jpg", "DCTDecode(JPEG)"
    if "/JPXDecode" in fk:
        return "jpx", "JPXDecode(JPEG2000)"
    if "/CCITTFaxDecode" in fk:
        return "tiff", "CCITTFax"
    return None, fk


def extract_with_pypdf(pdf_path, out_dir, dpi=300):
    reader = PdfReader(pdf_path)
    stem = os.path.splitext(os.path.basename(pdf_path))[0]
    results = []
    mb = reader.pages[0].mediabox
    page_h = float(mb.height) if hasattr(mb, "height") else float(mb[3])
    for pi, page in enumerate(reader.pages, start=1):
        names = _image_names(page)
        if not names:
            continue
        coords = _scan_coords(page, names)
        for name, (xref, obj) in names.items():
            w = obj.get("/Width")
            h = obj.get("/Height")
            ext, fdesc = _filter_ext(obj)
            box = coords.get(name)  # (x0,y0,x1,y1) y-up
            rect_top = None
            if box:
                x0, y0, x1, y1 = box
                rect_top = {
                    "x0": round(x0, 1), "y0": round(page_h - y1, 1),
                    "x1": round(x1, 1), "y1": round(page_h - y0, 1),
                }
            saved = None
            note = None
            if ext:  # 原始字节可直接存
                raw = obj.get_data()
                fname = f"{stem}_p{pi:02d}_{name.strip('/')}.{ext}"
                fpath = os.path.join(out_dir, fname)
                with open(fpath, "wb") as fh:
                    fh.write(raw)
                saved = fpath
            else:
                note = f"需 Pillow/PyMuPDF 编码({fdesc});本地沙箱装不了原生包,已 deferred"
                # 尝试 PyMuPDF 单图栅格(若有)
                if HAS_PYMUPDF and box is not None:
                    try:
                        doc = fitz.open(pdf_path)
                        pg = doc[pi - 1]
                        clip = fitz.Rect(box[0], box[1], box[2], box[3])
                        pix = pg.get_pixmap(clip=clip, dpi=dpi)
                        fname = f"{stem}_p{pi:02d}_{name.strip('/')}.png"
                        fpath = os.path.join(out_dir, fname)
                        pix.save(fpath)
                        saved = fpath
                        note = None
                    except Exception as ex:
                        note = f"PyMuPDF 栅格失败:{ex}"
            results.append({
                "page": pi, "name": name, "xref": xref,
                "width": int(w) if w else None, "height": int(h) if h else None,
                "filter": fdesc,
                "rect_pdf_yup": None if not box else {
                    "x0": round(box[0], 1), "y0": round(box[1], 1),
                    "x1": round(box[2], 1), "y1": round(box[3], 1)},
                "rect_top_origin": rect_top,
                "saved": saved, "note": note,
            })
    return results, page_h


# ----------------------------------------------------------------------------
# PyMuPDF 后端(若可用)
# ----------------------------------------------------------------------------
def extract_with_pymupdf(pdf_path, out_dir, dpi=300, raster_pages=False):
    doc = fitz.open(pdf_path)
    stem = os.path.splitext(os.path.basename(pdf_path))[0]
    mat = fitz.Matrix(dpi / 72.0, dpi / 72.0)
    results = []
    for pi in range(len(doc)):
        page = doc[pi]
        for info in page.get_images(full=True):
            xref = info[0]
            try:
                rects = page.get_image_rects(xref)
            except Exception:
                rects = []
            base = f"{stem}_p{pi + 1:02d}_x{xref}"
            meta = {}
            try:
                m = doc.extract_image(xref)
                meta = {"width": m.get("width"), "height": m.get("height"),
                        "filter": (f"bpc={m['bpc']}" if m.get("bpc")
                                   else (m.get("ext") or "n/a"))}
            except Exception:
                pass
            rect_list = rects if rects else [None]
            for ridx, rect in enumerate(rect_list):
                fname = (f"{base}_{ridx}.png" if len(rect_list) > 1
                         else f"{base}.png")
                fpath = os.path.join(out_dir, fname)
                if rect is not None:
                    pix = page.get_pixmap(clip=rect, matrix=mat)
                    rb = {"x0": round(rect.x0, 1), "y0": round(rect.y0, 1),
                          "x1": round(rect.x1, 1), "y1": round(rect.y1, 1)}
                else:
                    pix = page.get_pixmap(matrix=mat)
                    rb = None
                pix.save(fpath)
                results.append({
                    "page": pi + 1, "xref": xref, "name": None,
                    "width": meta.get("width"), "height": meta.get("height"),
                    "filter": meta.get("filter", "n/a"),
                    "rect_pdf_yup": rb, "rect_top_origin": None,
                    "saved": fpath, "note": None,
                })
        if raster_pages:
            pix = page.get_pixmap(matrix=mat)
            fp = os.path.join(out_dir, f"{stem}_page_{pi + 1:02d}_full.png")
            pix.save(fp)
            results.append({"page": pi + 1, "xref": None, "name": "PAGE_RASTER",
                            "width": pix.width, "height": pix.height,
                            "filter": "rasterized-page", "rect_pdf_yup": None,
                            "rect_top_origin": None, "saved": fp,
                            "note": "整页栅格(供矢量图人工/半自动裁剪)"})
    return results, doc[0].rect.height


# ----------------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------------
def iter_pdfs(target):
    if os.path.isdir(target):
        for fn in sorted(os.listdir(target)):
            if fn.lower().endswith(".pdf"):
                yield os.path.join(target, fn)
    else:
        yield target


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", help="PDF 文件或目录")
    ap.add_argument("--out", default=None, help="输出图片目录")
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--manifest", default=None, help="写出 JSON 清单路径")
    ap.add_argument("--raster-pages", action="store_true",
                    help="PyMuPDF 模式:额外栅格化整页(用于矢量图裁剪)")
    args = ap.parse_args()

    backend = "pymupdf" if HAS_PYMUPDF else "pypdf"
    all_results = []
    summary = {"backend": backend, "papers": []}

    for pdf_path in iter_pdfs(args.target):
        out_dir = args.out or os.path.join(
            os.path.dirname(pdf_path) or ".",
            "extracted_figures", os.path.splitext(os.path.basename(pdf_path))[0])
        os.makedirs(out_dir, exist_ok=True)
        if backend == "pymupdf":
            res, ph = extract_with_pymupdf(pdf_path, out_dir, args.dpi, args.raster_pages)
        else:
            res, ph = extract_with_pypdf(pdf_path, out_dir, args.dpi)
        all_results.extend(res)
        saved_n = sum(1 for r in res if r["saved"])
        summary["papers"].append({
            "pdf": os.path.basename(pdf_path),
            "images": len(res), "saved": saved_n,
            "deferred": len(res) - saved_n, "page_height": round(ph, 1),
        })
        print(f"[{(os.path.basename(pdf_path))}] 内嵌图 {len(res)} 张, "
              f"已存 {saved_n}, 待编码 {len(res) - saved_n}")

    if args.manifest:
        with open(args.manifest, "w", encoding="utf-8") as fh:
            json.dump({"summary": summary, "figures": all_results},
                      fh, ensure_ascii=False, indent=2)
        print(f"清单已写出: {args.manifest}")

    print("\n=== 汇总(后端: {}) ===".format(backend))
    tot = sum(p["images"] for p in summary["papers"])
    print(f"PDF 数: {len(summary['papers'])}  内嵌图总数: {tot}")
    for p in summary["papers"]:
        print(f"  {p['pdf']:40s} 图={p['images']:3d} 存={p['saved']:3d} "
              f"待={p['deferred']:3d} 页高={p['page_height']}")


if __name__ == "__main__":
    main()
