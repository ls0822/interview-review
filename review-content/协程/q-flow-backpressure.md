---
id: q-flow-backpressure
type: qa
module: coroutine
knowledge_ref: kp-flow-backpressure-android
title: Flow 的背压怎么选，Android 上该怎么收集？
priority: P0
version: 1
---

## 问题
`buffer`、`conflate`、`collectLatest` 有什么差别？`flatMapConcat` / `Merge` / `Latest` 和 `flowOn`、`catch`、`stateIn` 怎么配？为什么 `StateFlow` 不适合一次性事件，什么时候改用 `Channel`？

## 答案
冷流默认是会合：`emit` 要等这次 `collect` 块返回。这就是背压，生产被消费拖住，但不会无限堆积。

三种「处理不过来」不要混：

| 操作符 | 牺牲 | 适合 |
|--------|------|------|
| `buffer` | 多占有限内存；默认满了仍挂起发送方 | 不能丢、允许上游略为领先 |
| `conflate` | 丢掉中间值 | 进度、刷新，只留最新 |
| `collectLatest` | 取消上一值还没跑完的处理 | 搜索；处理块必须真能在挂起点取消 |

`flatMapConcat` 等上一个内部流结束，顺序稳定。`flatMapMerge` 并发收集，默认 16，到顶则外层挂起，结果会交错。`flatMapLatest` 是外层来了新值就取消上一个内部流。分页用 Concat，一批独立请求用 Merge，搜索用 Latest。

`flowOn` 只影响它上面的上游，收集者留在原来的协程。不能靠它把 `collect` 切到主线程，也不要往里放 `Job`（会报 Flow context cannot contain job）。`catch` 只接上游异常，不接 `collect` 里抛的，也不吞取消。`retry` 把冷流从头再跑，取消不重试；要放在 `stateIn` 之前，并做退避。

`stateIn` / `shareIn` 用 Scope 把冷流跑成热流。`Eagerly` 立刻启动并一直跑到 Scope 取消。`Lazily` 等第一个订阅者，之后也不停。`WhileSubscribed(5_000)` 在无人订阅超过 5 秒后取消上游，旋转这种短空窗不断开，退后台才停。失败要在 `stateIn` 前 `catch` 成错误态，否则共享协程变成未捕获，`viewModelScope` 虽是监督者、不会拆掉兄弟，调试时仍可能崩溃。

界面用 `repeatOnLifecycle(STARTED)` 或 `collectAsStateWithLifecycle`。STOP 时收集协程被取消，订阅数归零，`WhileSubscribed` 的计时才开始。`launchWhenStarted` 只挂起不取消，这条链是断的。

`StateFlow` 不适合 Toast 或导航：新收集者立刻拿到当前值，旋转会再触发；`equals` 相同的第二次点击不会通知；它是广播，不是取走即消失。一次性提示用 `MutableSharedFlow(replay = 0, extraBufferCapacity = 1)` 再 `tryEmit`（点击回调不能挂起，所以不能 `emit`）。工作队列要恰好一个消费者，用 `Channel`。冷 Flow 被两个人 `collect` 会把上游做两遍。
