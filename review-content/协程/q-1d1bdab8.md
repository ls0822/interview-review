---
id: q-1d1bdab8
type: qa
module: coroutine
knowledge_ref: kp-coroutine-basics
title: 优势是什么？别夸大什么？
priority: P0
version: 1
---

## 问题
优势是什么？别夸大什么？

## 答案
**A：优势**

1. 等网络/IO 时用挂起，不占死线程 → 同样线程数撑更多请求。  
2. 代码从上到下写，少回调地狱。  
3. `Scope` 取消，一起停，少泄漏。  
4. `withContext` 切「在哪类线程跑」很直观。

**别夸大**

1. 算得狠的 CPU 活，协程不会变出更多核。  
2. 多协程改同一变量，照样要同步。  
3. 乱 `GlobalScope.launch` 一样泄漏。

---
