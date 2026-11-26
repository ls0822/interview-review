---
id: q-a02f5c4a
type: qa
module: coroutine
knowledge_ref: kp-coroutine-channel-mutex
title: Channel 和阻塞队列像不像？
priority: P1
version: 1
---

## 问题
Channel 和阻塞队列像不像？

## 答案
很像生产者消费者；差别是 Channel 的等待是**挂起协程**，不是阻塞线程。

---

# 四、Flow · 冷流 · 热流
