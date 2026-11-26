---
id: q-c02dadbe
type: qa
module: language
knowledge_ref: kp-concurrent-collections
title: 同步集合 vs 并发集合？
priority: P1
version: 1
---

## 问题
同步集合 vs 并发集合？

## 答案
`Collections.synchronizedXxx` 粗锁；`ConcurrentHashMap` 等细粒度。迭代 synchronizedList 仍要手动同步。

---

## 1.4 异常
