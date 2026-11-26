---
id: q-641c3eae
type: qa
module: architecture
knowledge_ref: kp-arch-patterns
title: 为什么要分这些架构？
priority: P0
version: 1
---

## 问题
为什么要分这些架构？

## 答案
页面会同时做三件事：画界面、响应用户、改数据和发请求。全写在 Activity 里，几周后没人敢改。架构就是规定这三件事的交接点，让「用户点了一下」之后的去向是固定的。

---
