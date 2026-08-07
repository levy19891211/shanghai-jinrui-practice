#!/usr/bin/env python3
"""TMUA 官方真题 PDF 解析质量评估脚本
用法:python eval_pdf.py <pdf路径> [页数限制]
"""
import sys
import pdfplumber

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "assets/papers/tmua/TMUA-2016-paper-1.pdf"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 3

    with pdfplumber.open(path) as pdf:
        print(f"总页数: {len(pdf.pages)}")
        for i, page in enumerate(pdf.pages[:limit]):
            text = page.extract_text() or ""
            print(f"\n{'='*60}\n第 {i+1} 页 (字符数: {len(text)})\n{'='*60}")
            print(text[:1200])

if __name__ == "__main__":
    main()
