---
id: q-a024a0ca
type: qa
module: android
knowledge_ref: kp-handler-system
title: Handler / Looper / MessageQueue 原理？
priority: P0
version: 1
---

## 问题
Handler / Looper / MessageQueue 原理？

## 答案
1. 每线程一个 Looper（主线程已准备）。  
2. `loop()` 从 MessageQueue 取消息 → `Handler.dispatchMessage`。  
3. Handler 绑定创建时线程的 Looper；跨线程通信靠入队。  
4. Message 复用池；注意 what/obj 泄漏。

---
