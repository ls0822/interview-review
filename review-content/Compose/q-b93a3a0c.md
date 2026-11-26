---
id: q-b93a3a0c
type: qa
module: compose
knowledge_ref: kp-compose-recomposition
title: Compose 里怎么放 WebView / Cocos？
priority: P0
version: 1
---

## 问题
Compose 里怎么放 WebView / Cocos？

## 答案
1. `AndroidView`：在 Compose 树里嵌一个传统 View。工厂里 `WebView(context)` 或 Cocos 的 Surface，`update` 里把新状态写进这个 View。
2. 反过来，老页面用 `ComposeView` 嵌一块 Compose。`setContent { }`，并且要有 `ViewCompositionStrategy`（常见是 `DisposeOnViewTreeLifecycleDestroyed`），避免泄漏。
3. 你的课堂：课件容器是 H5/Cocos，走 `AndroidView`；工具条、连麦、数字人控制是 Compose，叠在容器上面或旁边。
4. 触摸：上面的 Compose 层不需要吃事件的区域要把点击透下去，否则课件划不动。讲的时候主动说「层级和事件」，面试官会觉得你真做过。

---
