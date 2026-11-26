---
id: q-f4afccef
type: qa
module: coroutine
knowledge_ref: kp-coroutine-basics
title: 协程和线程到底啥关系？
priority: P0
version: 1
---

## 问题
协程和线程到底啥关系？

## 答案
1. **线程** = 工人。  
2. **协程** = 工单（任务）。  
3. 工单必须有工人才能执行；一个工人可以做很多张工单（做一张挂起，再拿另一张）。  
4. 所以：**协程不会消灭线程**；`Dispatchers` 背后还是线程或线程池。

---
