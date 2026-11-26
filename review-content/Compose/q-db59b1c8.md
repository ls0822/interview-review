---
id: q-db59b1c8
type: qa
module: compose
knowledge_ref: kp-compose-recomposition
title: 状态怎么接到 Compose？
priority: P0
version: 1
---

## 问题
状态怎么接到 Compose？

## 答案
1. ViewModel 暴露 `StateFlow`。
2. 界面用 `collectAsStateWithLifecycle()`。页面到后台不再收集，避免浪费和泄漏。
3. 信令、Bridge 回调不要直接改 Composable 里的变量，先写进 ViewModel，界面只观察状态。
4. 和冷热流那题接得上：`StateFlow` 有当前值，旋转重建后界面马上能画出来。

---

## 6.3 小学产品 1 分钟版

界面三层：底层课件容器（H5/Cocos，`AndroidView`），中间数字人/动画，上层 Compose 工具条。  
房间、页码、连麦是状态，信令改状态，Compose 重组出新界面。  
Bridge 只负责和课件通信，不在 Composable 函数体里直接调。  
进房时模型和动画还在下载，界面用状态画出「加载中」，下载结果再改状态，不阻塞重组本身。

---

## 自测

1. 重组和重绘是一回事吗？  
2. `remember` 旋转后还在吗？  
3. 为什么不能在 Composable 里直接 `lifecycleScope.launch`？  
4. 课件 WebView 放在 Compose 的哪个 API 里？更新页码写在 `factory` 还是 `update`？
