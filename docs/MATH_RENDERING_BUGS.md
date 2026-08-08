# 题目公式渲染 Bug 库与预防规范

> 本文档记录「上海金瑞学校 附加笔试刷题系统」中**题目数学公式渲染**发现的所有 Bug、
> 根因、修复与**预防规则**。任何对 `lib/rich.tsx`(latexify / smartMath / renderRich)的修改,
> 必须:① 阅读本库;② 修改后运行 `npm run verify:math` 全题库回归;③ 更新本库。

## 一、已修复 Bug 清单(按时间倒序)

| # | 现象 | 根因 | 修复 | 提交 |
|---|------|------|------|------|
| 14 | `log`/`sin`/`\frac` 前**露出反斜杠**、排版错乱换行;且反复出现于导入题 | ① 视觉模型/录入常写 `$ f(x) $`(`$` 后带空格),行内公式正则 `\$([^\s$][^$]*)\$` 要求 `$` 后非空白 → 整段被降级为普通文本;② smartMath 不认反斜杠开头的裸命令(`\log`)→ 按纯文本字面显示反斜杠 | **三层修复**:① `rich.tsx` 行内公式正则改 `\$([^$]+?)\$`(允许 `$` 后空格);② smartMath 识别含 `\` 的裸命令(`\\[a-zA-Z]+`,覆盖 `3\pi`),latexify 函数名 lookbehind 加 `\\` 防 `\log`→`\\log`;③ 导入层 `text-clean.js` 新增 `normalizeInlineFormula`(`$ x $`→`$x$`,并入 `normalizeNewlines`/`toCanonicalText`),存量数据全库清洗 | 865a4f8 5f4e126 479a527 |
| 13 | `log₁₀(2/(a+2b+3c))` 分数显示斜杠 | KaTeX 数学模式**不推断语义**,`/` 必须显式 `\frac`;而 `$...$` 数学分支**跳过了 latexify** | math 分支渲染前也调 `latexify(t.expr)`(幂等) | 02b4baf |
| 12 | `2 / (a+2b+3c)`(带空格)分数不转 | 分数正则 `/` 前后不容忍空格 | 正则加 `\s*` | 1cd0aca |
| 11 | `(n−1)/(3n−1)` 两边括号未转分数 | 分数正则只匹配 `A/(B)` | 增加 `\(A\)/(B)` 形式;并限制 A 首字符为字母/数字(避免吞 `+`/`−` 运算符) | bcf5eec |
| 10 | `3x/(x−2√3)` 中 3 显示在根号外 | 外层 `align-middle`(vertical-align:middle)干扰 KaTeX 内部基线计算 | 外层改 `align-baseline`;另加 `/` → `\frac` 自动转换 | 72c962a |
| 9 | `2x²−11x+c = 0differ by 2`(0 与 differ 粘连) | KaTeX 数学模式**忽略表达式尾部空格** | flushMath 后显式追加 `" "` 文本节点 | c11b292 |
| 8 | 题干英文单词(Given/sum/it)被当数学整段斜体 | 字符类 `[+\-−*/=...]` 中 `+\-−` 被解析为**范围**(+ 到 −,覆盖整个 ASCII)→ 任意单字符误判为运算符 | `\-` 转义、`−` 移末尾;MIXED 拆数字头/字母头两式;纯小写单词(≥2 字非函数名)判文本 | f9fb5a7 |
| 7 | 单字母变量 x/y 被当英文单词 | PURE_WORD `/^[a-z]+$/` 误伤单字母 | 改为 `/^[a-z]{2,}$/` | f9fb5a7 |
| 6 | `3cos θ` 的 cos 未转 `\cos` | `\b` 边界在数字与字母之间**不成立**(3c 都是 \w) | 函数名替换用 `(?<![a-zA-Z])` 否定后视 | 1ce9f6c |
| 5 | 选项 `q.options.map` 崩溃 | 后端创建会话返回的 options 是 JSON 字符串(仅 GET 详情解析过) | 后端 `safeParseOptions()` 统一解析为数组 + 前端 normalize 兜底 | 23ee8cc |
| 4 | 图形题图片不显示 | 渲染层未支持 Markdown 图片语法 | RichText 解析 `![alt](url)` | ce89346 |
| 3 | 根号 `√3` 显示为 `√` 加散落 3 | latexify 未将 `√` 转 `\sqrt` | `/√\(...\)/→\sqrt{...}`,`/√[a-zA-Z0-9]/→\sqrt{字符}` | 1ce9f6c |
| 2 | `x^2` 上标不标准 | latexify 未处理 `^` | `\^\(...\)→^{...}`,`\^[0-9a-zA-Z]→^{...}` | 1ce9f6c |
| 1 | 公式显示不标准(题干中 3x^2 等纯文本) | 只有纯数学选项被渲染,题干中夹英文的公式未识别 | smartMath 智能切分 + latexify + KaTeX | 1ce9f6c |

## 二、预防规则(核心规范,改代码前必读)

1. **正则字符类中的 `-` 必须转义(`\-`)或放首尾**,否则形成范围陷阱(如 `[-−]` 覆盖整个 ASCII)。凡是含 `+`/`-`/`−`/`*` 等符号的字符类,逐字符检查。
2. **KaTeX 不做语义推断**:`\frac`、`\sqrt`、`\log` 等所有命令必须显式。latexify 是"语义化转换器",**任何传给 KaTeX 的输入都必须先过 latexify**(text 分支和 math 分支都要)。
3. **KaTeX 数学模式忽略空格**(行内):混排时数学片段后必须显式补视觉空格(flushMath 后 push `" "`)。
4. **不要用 `vertical-align: middle` 包裹 KaTeX**,用默认/`baseline`,否则根号、上下标基线错乱。
5. **函数名转换**(sin/cos/log...)用 `(?<![a-zA-Z])` 而非 `\b`(数字后 `\b` 不成立);**且 lookbehind 必须再排除反斜杠 `(?<![a-zA-Z\\])`**,否则会把已是 `\log` 的重复加 `\` 成 `\\log`(见 #14)。
6. **单字母变量**排除英文冠词/代词 `a/A/i/I`;纯小写英文单词(长度≥2、非函数名)判文本。
7. **选项的 options 字段**:后端接口返回前必须解析为数组(`safeParseOptions`),前端渲染再做一次 normalize 兜底。
8. **改动必须回归**:改完 latexify/smartMath 后运行 `npm run verify:math --workspace=apps/api`(全题库扫描,检测 KaTeX 渲染错误、未转换残留、**公式外裸命令**)。
9. **行内公式正则必须允许 `$` 后带空格**:统一用 `\$([^$]+?)\$`(而非 `[^\s$]`),否则 `$ f(x) $` 会被当纯文本、内部 `\log` 等裸命令露出反斜杠。**此正则在前端 `rich.tsx`、`autofix.js`、`scripts/verify_math.js` 三处各有一份,改动必须同步**(见 #14)。
10. **`$...$` 包裹外的裸反斜杠命令必须被 smartMath 识别为数学**(`/\\[a-zA-Z]+/`),否则字面露出 `\`。渲染层兜底之外,导入归一化(`text-clean.js` 的 `normalizeInlineFormula`)负责把数据规范成 `$...$`。
11. **核心审查项——公式外裸命令**:`autofix.js` 的 `bare_latex` 规则与 `healthCheck`、`verify_math.js` 的裸命令扫描,会检出 `$` 外未包裹的 `\log`/`\sin`/`\frac`/`3\pi` 等并报告;所有导入/修改的数据入库前都应通过该审查。

## 三、验证用例集(手动/自动化回归样本)

以下字符串经 latexify 后必须全部能由 KaTeX 无错误渲染:

```
3x^2 − 7xy = 5
sin^2 θ + 3cos θ = 3
y = −log₁₀(1 − x) for x < 1
2x^2 − 11x + c = 0
10^(−y)
√(11/2)
2x/(x − 2√3)
(n − 1)/(3n − 1)
log₁₀(2/(a + 2b + 3c))
5650/79.5
(4 − x^2)[(1 + 2x + 3x^2)^4 − (1 + 4x^3)^3]
Σ(n=1..100) aₙ
0 ≤ θ ≤ 4π
```

**#14 回归样本($ 后带空格 / 裸命令,必须正确渲染、不得露出反斜杠):**

```
$ f(x) = x^{\frac{1}{7}}(x^2 - x + 1) $
We are solving $$ (x+1)(3-x) = 2(1 - \cos(\pi x)). $$
原方程：$2\log_{10}(x - y) = \log_{10}(2 - 2x) + \log_{10}(y + 5)$
The function is $y = x^3 - 6x + 3$. Differentiating gives:
Use trapezium rule with 3 strips over $[\frac{1}{2}, 2]$.
选项: 5 | 10 | 15 | 3\pi | 9\pi | 12\pi      (裸 \pi 也须渲染)
$\log_{10}\frac{3}{2}$                       (latexify 不得变 \\log)
```

## 四、运行验证

```bash
# 全题库数学渲染回归(需后端已启动或直接连库)
npm run verify:math --workspace=apps/api
```
