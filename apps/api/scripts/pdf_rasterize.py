#!/usr/bin/env python3
"""把 PDF 逐页栅格化为 PNG,并附带每页纯文本(供视觉模型辅助判断题号/结构)。

用法:
    python3 pdf_rasterize.py <input.pdf> <out_dir> [dpi]

输出(JSON 到 stdout):
    {"pages": [{"path": "<out_dir>/page_1.png", "text": "..."}, ...]}
"""
import sys
import os
import json

try:
    # 优先用新包名:`import fitz` 会往 stdout 打 deprecation warning,污染 JSON 输出
    import pymupdf as fitz
except ImportError:
    try:
        import fitz  # 老版本 PyMuPDF 回退
    except ImportError:
        sys.stderr.write("ERROR: PyMuPDF 未安装,请先 `pip3 install pymupdf`\n")
        sys.exit(3)


def main():
    if len(sys.argv) < 3:
        sys.stderr.write("usage: pdf_rasterize.py <input.pdf> <out_dir> [dpi]\n")
        sys.exit(2)

    pdf_path = sys.argv[1]
    out_dir = sys.argv[2]
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 150

    if not os.path.exists(pdf_path):
        sys.stderr.write("ERROR: 文件不存在: %s\n" % pdf_path)
        sys.exit(4)

    os.makedirs(out_dir, exist_ok=True)

    doc = fitz.open(pdf_path)
    pages = []
    for i, page in enumerate(doc):
        try:
            pix = page.get_pixmap(dpi=dpi)
            p = os.path.join(out_dir, "page_%d.png" % (i + 1))
            pix.save(p)
            text = page.get_text() or ""
            pages.append({"path": p, "text": text})
        except Exception as e:  # 单页失败不影响其它页
            sys.stderr.write("WARN: 第 %d 页渲染失败: %s\n" % (i + 1, e))
    doc.close()

    print(json.dumps({"pages": pages}, ensure_ascii=False))


if __name__ == "__main__":
    main()
