---
id: q-f2da913e
type: qa
module: concurrent
knowledge_ref: kp-thread-pool
title: 默认线程池到底是哪个？
priority: P0
version: 1
---

## 问题
默认线程池到底是哪个？

## 答案
分两层，面试官经常在这里绕。

第一层：你写 `launch { }` 时用谁。用的是当前协程上下文里已经有的 Dispatcher。上下文里没有，标准构建器才落到 `Dispatchers.Default`。`viewModelScope`、`lifecycleScope` 创建时就带了 `Dispatchers.Main.immediate`，所以里面不写 Dispatcher 的 `launch` 跑在主线程，不是 Default。

第二层：Default 和 IO 的线程从哪来。JVM 上它们共用调度器 `CoroutineScheduler`，线程名一般是 `DefaultDispatcher-worker-N`。

- Default：并行度默认大约等于 CPU 核数，至少 2。任务当计算任务，工人数到了就排队，不再加线程。
- IO：同一池子，但任务标成「可能阻塞」。池子可以再开线程，默认并行度至少 64（机器核数更多就按核数）。系统属性 `kotlinx.coroutines.io.parallelism` 可以改这个上限。
- Main：不是池。Android 上是主线程的 `Handler`。
- Unconfined：调用它的那条线程上开始跑，第一次挂起之后，在哪个线程恢复就留在哪个线程。行为难推断，业务代码不用。

自己要固定 4 条线程时，用 `Executors.newFixedThreadPool(4).asCoroutineDispatcher()`，用完 `close()`。或者 `Dispatchers.IO.limitedParallelism(4)`，这是限制同时跑的数量，不是新建一个 4 线程的池。
