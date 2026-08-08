# 版本历史

> 版本号规则：功能/修复上线即升版本号（V1.0 → V1.1 → ...）。
> 版本号同步维护三处：根目录 `VERSION` 文件、`apps/web/lib/version.ts`、本文件。
> 每次发布必须在本文件顶部追加一条记录（日期 + 版本 + 变更摘要）。

## V1.4 (2026-08-08)
- 「冒险模式」Phase B 事件特效：
  - **Boss 战氛围**：红色暗角背景叠加 + 像素 Boss 头像(光晕浮动) + 「⚔ BOSS 出现了!」横幅 + 「🏆 BOSS 击破!」横幅 + 低鸣 boss_appear 音。
  - **奖励节点强化**：卡片持续金币雨(CSS emoji 双层错落) + 「🎁 奖励已领取!」横幅滑入。
  - **通关结算**：WON 时全屏彩带幕(conic-gradient 双层反向旋转) + 大横幅「🏆 通关!」 + 升调 victory 音。
  - **死亡暗幕**：DEAD 时 radial 渐变暗幕渐入。
  - **Kenney CC0 美术素材**：`boss.png`(棕色大怪物)/`enemy.png`(橙色火焰小怪) 来自 Kenney Pixel Platformer，24×24 像素 + `image-rendering: pixelated` 放大锐利，附 CC0 LICENSE。
  - 零新依赖(纯 CSS + 现有 Web Audio + Kenney 公开素材)，零侵入可回滚。

## V1.3 (2026-08-08)
- 「冒险模式」Phase A 特效：
  - **Web Audio 合成音效**（零素材）：答对叮、连击升调（combo 越高音越高）、答错、护盾、奖励金币声、Boss 低音轰鸣、死亡下行音。
  - **Canvas 粒子**：答对金色爆发、答错红色、奖励金币雨、Boss 击败彩带，DPR 自适应。
  - **氛围**：深色星空渐变背景 + 流动光；连击 ≥3 火焰跳动 + 数字脉冲；答错屏幕震动；低血量血条警示；卡片 pop-in、奖励礼物盒弹跳。
  - 零新依赖（纯 CSS keyframes + Canvas + Web Audio），可整体回滚。

## V1.2 (2026-08-08)
- 「冒险模式」二期：
  - **道具系统**：护盾(答错抵挡)/药水(回血)/跳过(直接推进)/提示(排除 2 个错误选项)；连击 3/5/10 与普通题随机掉落；`/api/roguelike/use-item` 后端权威扣减。
  - **Boss 薄弱点联动**：每 5 层 Boss，优先从学生错题本抽题，击败给金币+药水。
  - **奖励节点**：每 3 层不答题直接领奖励(金币/概率回血/药水)，`/api/roguelike/claim`。
  - **断线存档**：`/api/roguelike/active` + 进入页面提示继续上次冒险。
  - 地图节点序列 `{ answered, inventory, map }` 存入 items(兼容一期纯数组)。

## V1.1 (2026-08-08)
- 新增「冒险模式」（Roguelike 一期）：线性爬塔 + 连续正确(combo)激励 + 血量 + 结算页。
- 后端：`RoguelikeRun` 表 + `/api/roguelike` 路由（start/answer/get/quit），判分复用现有逻辑、进度后端权威计算。
- 前端：学生端新增 `/app/roguelike` 页面与导航入口；答题渲染复用 `renderRich`。
- 修复：显示类问题一批（#16-#20，详见 `docs/MATH_RENDERING_BUGS.md`）。

## V1.0 (2026-08-08)
- 初始版本基线（版本管理建立时固化）。
- 已有能力：题库管理（学科 Tab/知识点/难度筛选/排序）、知识点库（四门学科）、PDF/Excel/Word/JSON 批量导入（含自动知识点归类）、试卷管理（手动组卷/套题自动成卷/审核流程）、学生练习/模拟考（试卷时长强制、倒计时自动交卷）、错题本、成绩统计/雷达图、面试练习、学生管理。
- 修复：历史渲染 Bug #1-#15（见 `docs/MATH_RENDERING_BUGS.md`）。
