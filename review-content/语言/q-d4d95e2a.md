---
id: q-d4d95e2a
type: qa
module: language
knowledge_ref: kp-synchronized-lock
title: 线程同步与锁？
priority: P0
version: 1
---

## 问题
线程同步与锁？

## 答案
1. Java：`synchronized`、`ReentrantLock`、`volatile`、`Atomic*`、`Semaphore`。  
2. 协程：`Mutex`（挂起等待）、Channel 少共享。  
3. 死锁：破坏循环等待、固定加锁顺序、缩小临界区。

---
