# 教案注释模式视觉验收

## 参考来源

- 注释模式与蓝色注释光标：`C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-6891cd43-322a-489a-b092-10649ef265cc.png`
- 底部固定椭圆输入栏：`C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-5c0acce1-318c-45b8-b041-7ff43cf0191e.png`

## 实现截图

- 桌面注释模式：`C:\Users\Administrator\.codex\visualizations\2026\07\31\019fb891-961c-7df1-bb7e-76e670db850a\lesson-annotation-desktop-final.jpg`
- 1024 像素窄屏：`C:\Users\Administrator\.codex\visualizations\2026\07\31\019fb891-961c-7df1-bb7e-76e670db850a\lesson-annotation-1024-final.jpg`
- 参考图与成品同屏比较：`C:\Users\Administrator\.codex\visualizations\2026\07\31\019fb891-961c-7df1-bb7e-76e670db850a\lesson-annotation-reference-comparison-final.jpg`

## 验收状态

- 桌面视口：1440 × 900；顶部显示“正在注释”，左侧为原版，右侧为空候选稿，底部输入栏固定居中。
- 窄屏视口：1024 × 768；原版与修改版仍保持左右并列，没有横向页面溢出；仅在不超过 800 像素时改为上下排列。
- 蓝色注释光标只在 `.lesson-section-order` 内出现，课程导航、站点控件和设置均不在可注释范围。
- 大纲仅保留拖拽手柄，没有上下箭头；已用真实鼠标拖动将“教学目标”移至第三位并拖回首位，排序与正文同步。
- 正文标题后没有逐节批注按钮，旧右侧 AI 面板已删除；批注通过稳定内容路径绑定到具体题目、字段或自定义模块。
- 已实际验证标准模块和新增自定义模块都能建立注释；多条注释可编辑、删除，失败后仍保留并可重试。
- 参考图是 Codex 的全局注释交互，成品保留其核心行为，并按教案场景增加原稿/候选稿对照；视觉差异属于场景适配，不是回归偏差。

## 比较记录

1. 首次实现完成顶部模式按钮、左右对照和底部输入栏。
2. 浏览器实测发现系统光标与蓝色注释光标同时出现，将正文注释区系统光标隐藏，只保留蓝色注释光标。
3. 再次构建并检查桌面与 1024 像素状态；1024 像素仍保持左右对比，未发现遮挡、裁切、溢出或旧组件残留。
4. 终审发现结构化板书的派生文本可能滞后，已在精确批注合并后同步重算并补回归测试。

passed
