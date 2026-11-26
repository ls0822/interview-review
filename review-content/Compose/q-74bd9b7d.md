---
id: q-74bd9b7d
type: qa
module: compose
knowledge_ref: kp-crypto-basic
title: `remember`、`mutableStateOf`、`rememberSav
priority: P0
version: 1
---

## 问题
`remember`、`mutableStateOf`、`rememberSaveable` 分别干什么？

## 答案
1. `mutableStateOf`：一块可观察的状态。谁在组合时读了它，它一变就重组谁。
2. `remember`：重组时把值留住。没有它，每次重组局部变量都会回到初值。
3. `remember` 挡的是重组，挡不住旋转、进程被杀。那种要活下来的用 `rememberSaveable`（能放进 Bundle 的）或 ViewModel。
4. 页面级、要过生命周期的状态放 ViewModel；只活在这次组合里的（动画、滚动）用 `remember`。

---
