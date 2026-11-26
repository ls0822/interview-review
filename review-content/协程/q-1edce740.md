---
id: q-1edce740
type: qa
module: coroutine
knowledge_ref: kp-concurrent-collections
title: 并发集合？
priority: P0
version: 1
---

## 问题
并发集合？

## 答案
别共享裸 `HashMap`；用 `ConcurrentHashMap` 等；`synchronizedList` 粗、迭代要手动同步。详解见《Java线程与并发》。

---

# 七、1 分钟口述稿 · P0

协程是跑在线程上的可挂起任务。`launch` 丢任务，`async` 取结果，`withContext` 临时切线程。  
Dispatcher 决定在 Main/IO/Default 哪类线程跑；挂起恢复不保证同一条 Thread。  
Channel 是协程队列；Flow 默认冷流，有人 collect 才产数据；StateFlow/SharedFlow 是热流做状态和事件。  
共享变量用 Mutex，限流用 Semaphore；底层仍要懂线程池和并发集合。

---

# 八、建议学习顺序

1. 词典 + Q1–Q4（挂起恢复）  
2. Q5–Q12（launch/Dispatcher/取消）  
3. Q13–Q15（Channel）  
4. Q16–Q23（Flow 冷热）  
5. Q24–Q26 + 口述  

配合：[语言-Kotlin与Java.md](./语言-Kotlin与Java.md)（空安全、sealed/data、扩展）  
入口：[基础知识/01-语言与JVM.md](./基础知识/01-语言与JVM.md)
