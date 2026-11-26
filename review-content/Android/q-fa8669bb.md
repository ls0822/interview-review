---
id: q-fa8669bb
type: qa
module: android
knowledge_ref: kp-handler-system
title: post 和 sendMessage 区别？IdleHandler？
priority: P1
version: 1
---

## 问题
post 和 sendMessage 区别？IdleHandler？

## 答案
1. post 本质也是 Message（callback 字段）。  
2. IdleHandler：消息队列空闲时回调，用于延迟初始化（别干重活）。

---
