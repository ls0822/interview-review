---
id: q-bb38e38c
type: qa
module: android
knowledge_ref: kp-handler-system
title: 子线程能创建 Handler 吗？
priority: P0
version: 1
---

## 问题
子线程能创建 Handler 吗？

## 答案
能，但要先 `Looper.prepare()`，最后 `Looper.loop()`；或用 HandlerThread（自带 Looper）。

---
