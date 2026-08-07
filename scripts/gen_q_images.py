#!/usr/bin/env python3
"""生成图形题图片素材(matplotlib)
- Q4: 五张卡片图(正面字母/背面数字)
- Q7: (x+y)(x^2-xy+y^2)=1 即 x^3+y^3=1 的四个选项图
- Q10: y=log2 x (x>1) 的六个选项图
输出到 apps/web/public/images/questions/
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

OUT = os.path.join(os.path.dirname(__file__), "..", "apps", "web", "public", "images", "questions")
os.makedirs(OUT, exist_ok=True)


def style_ax(ax, lim=2.6):
    ax.axhline(0, color="0.55", lw=0.8)
    ax.axvline(0, color="0.55", lw=0.8)
    ax.set_xlim(-lim, lim)
    ax.set_ylim(-lim, lim)
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    for s in ["top", "right"]:
        ax.spines[s].set_visible(False)


def q7_circle(ax):
    th = np.linspace(0, 2 * np.pi, 300)
    ax.plot(np.cos(th), np.sin(th), "#1f77b4", lw=2)


def q7_hyperbola(ax):
    t = np.linspace(-2.5, 2.5, 300)
    ax.plot(np.cosh(t), np.sinh(t), "#1f77b4", lw=2)
    ax.plot(-np.cosh(t), -np.sinh(t), "#1f77b4", lw=2)


def q7_cubic(ax):
    x = np.linspace(-2.6, 2.6, 400)
    ax.plot(x, np.cbrt(1 - x**3), "#1f77b4", lw=2)


def q7_parabola(ax):
    x = np.linspace(-2.5, 2.5, 300)
    ax.plot(x, x**2 - 1, "#1f77b4", lw=2)


def q10_style(ax):
    ax.axhline(0, color="0.55", lw=0.8)
    ax.axvline(0, color="0.55", lw=0.8)
    ax.set_xlim(0, 6.5)
    ax.set_ylim(-3.5, 3.5)
    ax.set_xticks([])
    ax.set_yticks([])
    for s in ["top", "right"]:
        ax.spines[s].set_visible(False)


def q10_log2(ax):
    x = np.linspace(0.05, 6.5, 400)
    ax.plot(x, np.log2(x), "#1f77b4", lw=2)


def q10_exp(ax):
    x = np.linspace(0, 6.5, 400)
    ax.plot(x, 2**x, "#1f77b4", lw=2)


def q10_recip(ax):
    x = np.linspace(0.05, 6.5, 400)
    ax.plot(x, 1 / x, "#1f77b4", lw=2)


def q10_linear(ax):
    x = np.linspace(0, 6.5, 400)
    ax.plot(x, x - 1, "#1f77b4", lw=2)


def q10_quad(ax):
    x = np.linspace(0, 6.5, 400)
    ax.plot(x, (x - 1) ** 2, "#1f77b4", lw=2)


def q10_neglog(ax):
    x = np.linspace(0.05, 6.5, 400)
    ax.plot(x, -np.log2(x), "#1f77b4", lw=2)


def q4_cards():
    cards = [("E", "7"), ("T", "4"), ("A", "2"), ("N", "9"), ("O", "6")]
    labels = ["A", "B", "C", "D", "E"]
    fig, axes = plt.subplots(1, 5, figsize=(6.4, 2.0), dpi=100)
    for ax, (letter, num), lab in zip(axes, cards, labels):
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1.15)
        ax.axis("off")
        ax.add_patch(plt.Rectangle((0.04, 0.08), 0.92, 0.92, fill=True, fc="white", ec="#333", lw=1.8))
        ax.text(0.5, 0.72, letter, ha="center", va="center", fontsize=15, fontweight="bold", color="#111")
        ax.text(0.5, 0.38, num, ha="center", va="center", fontsize=13, color="#111")
        ax.text(0.5, 0.02, f"({lab})", ha="center", va="center", fontsize=11, color="#555")
    fig.savefig(os.path.join(OUT, "q4-cards.png"), bbox_inches="tight")
    plt.close(fig)
    print("生成 q4-cards.png")


def main():
    figs = [
        ("q7-a.png", q7_circle, style_ax),
        ("q7-b.png", q7_hyperbola, style_ax),
        ("q7-c.png", q7_cubic, style_ax),
        ("q7-d.png", q7_parabola, style_ax),
        ("q10-a.png", q10_exp, q10_style),
        ("q10-b.png", q10_recip, q10_style),
        ("q10-c.png", q10_linear, q10_style),
        ("q10-d.png", q10_quad, q10_style),
        ("q10-e.png", q10_log2, q10_style),
        ("q10-f.png", q10_neglog, q10_style),
    ]
    for name, fn, st in figs:
        fig, ax = plt.subplots(figsize=(3.0, 3.0), dpi=100)
        st(ax)
        fn(ax)
        fig.savefig(os.path.join(OUT, name), bbox_inches="tight")
        plt.close(fig)
        print(f"生成 {name}")
    q4_cards()
    print("全部生成完成 ->", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
