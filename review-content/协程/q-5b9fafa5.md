---
id: q-5b9fafa5
type: qa
module: coroutine
knowledge_ref: kp-thread-pool
title: 为什么还要懂线程池？
priority: P0
version: 1
---

## 问题
为什么还要懂线程池？

## 答案
Dispatcher 背后就是线程池；和 Java 库互调仍会碰到。参数：core/max/queue/拒绝策略；无界队列坑：任务堆在队列，线程数起不来。详解见《Java线程与并发》。
