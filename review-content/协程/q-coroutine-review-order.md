---
id: q-coroutine-review-order
type: qa
module: coroutine
knowledge_ref: kp-coroutine-roadmap
title: 协程复习顺序与专家原理有哪些？
priority: P0
version: 1
---

## 问题
协程复习顺序与专家原理有哪些？哪些是 P0 必会，哪些是专家加分？

## 答案
不要按 API 字母表背。P0 按层讲，每一层只回答一个问题：

1. 模型 `kp-coroutine-basics`：挂起让出线程，阻塞占住工人；续体是书签；恢复不保证原线程。
2. 调度 `kp-coroutine-dispatchers`：`viewModelScope` 是 `SupervisorJob + Main.immediate`。阻塞放 IO，计算放 Default。`limitedParallelism(n)` 限的是同时跑的协程，不新建 n 条操作系统线程，也不保证永远同一条线程。
3. 上下文 `kp-coroutine-context`：同 Key 右边覆盖；子协程换上自己的 Job。`launch(Job())` 会脱离 Scope。
4. 结构化 `kp-coroutine-builders`：`launch` 并行且不把结果交回下一行，`async` 要 `await`，`withContext` 是同一张工单换线程。
5. 取消与异常 `kp-coroutine-cancel`：取消靠协作点；普通父会因非取消异常拆掉兄弟；CEH 只接没人接住且到达根（或监督者拒绝接手）的异常。
6. 回调桥 `kp-callback-to-suspend`：一次性回调用 `suspendCancellableCoroutine`，并在取消时停掉底层请求。
7. Channel / Mutex `kp-coroutine-channel-mutex`：容量 0 是会合；`Mutex` 不可重入，挂起不放锁。
8. 冷热流 `kp-coroutine-flow`：冷流每次收集重跑；`StateFlow` 有初值且 `equals` 去重。
9. Android 背压 `kp-flow-backpressure-android`：`buffer` / `conflate` / `collectLatest` 各牺牲什么；`WhileSubscribed(5_000)` 配合 `repeatOnLifecycle(STARTED)`；一次性事件不要进 `StateFlow`。

专家加分放在能讲清 P0 之后，被追问再展开，主篇是 `kp-coroutine-internals`：

- 状态机与 CPS：`label` 记住挂起点，`result` 带上一次的值或异常，`COROUTINE_SUSPENDED` 表示真挂起，调用方必须退栈。
- Continuation 被 Dispatcher 拦截后才恢复，所以池线程会变；`Main` 不变是因为只有一条主线程。
- `yield()` 让出并 `ensureActive()`；`delay(0)` 直接 return，不挂起。
- 同线程协程只在挂起点切换。操作系统能抢占线程，不会替你切换协程。
- 异常路径要能画出来：`launch` 对 `async`，`coroutineScope` 对 `supervisorScope`，以及 CEH 的三个条件。

口述验收就四句：现在在哪条线程，挂起后还在不在；取消缺了哪个协作点；异常有没有人接、父是不是监督者；这个值会被重放、合并，还是只交给一个消费者。第一分钟先讲这四句，状态机留给追问。
