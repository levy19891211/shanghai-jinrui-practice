#!/usr/bin/env python3
"""提取 TMUA 样卷文本并统计 CID 编码字符,用于建立映射表
用法:python extract_tmua.py <pdf> <out.txt>
"""
import sys
import re
from collections import Counter
import pdfplumber

def main():
    pdf_path, out_path = sys.argv[1], sys.argv[2]
    cids = Counter()
    full = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            full.append(f"\n===== PAGE {i+1} =====\n{text}")
            for m in re.findall(r"\(cid:(\d+)\)", text):
                cids[int(m)] += 1
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(full))
    print(f"写出 {out_path} 共 {sum(len(x) for x in full)} 字符")
    print(f"出现 {len(cids)} 种 CID 字符:")
    for cid, cnt in cids.most_common():
        print(f"  (cid:{cid}) x{cnt}")

if __name__ == "__main__":
    main()
