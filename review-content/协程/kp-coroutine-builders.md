---
id: kp-coroutine-builders
type: knowledge
module: coroutine
title: launch、async、withContext 与 Scope
priority: P0
version: 1
---

## 一句话

`launch` 丢出一张不要返回值的工单，`async` 要结果就 `await`，`withContext` 是同一张工单临时换线程；Scope 是这些工单的主人，主人取消，子工单一起收到取消。

## 组成与结构

| 构建器 | 产物 | 和调用方的关系 | 异常 |
|--------|------|----------------|------|
| `launch` | `Job` | 并发，不等结果 | 默认走向父协程 |
| `async` | `Deferred<T>` | 并发，`await` 取结果 | 存在 Deferred 里，`await` 时抛出 |
| `withContext` | 块的返回值 | 不并行，做完才到下一行 | 直接抛给当前协程 |
| `coroutineScope` | 等到所有子协程 | 结构化，子失败则取消兄弟 | 抛给调用方 |
| `supervisorScope` | 同样会等待 | 一个子失败不取消兄弟 | 子异常需要自己处理 |
| `runBlocking` | 堵住当前线程 | 把挂起世界接回阻塞世界 | 测试或 main 里用，Android 主线程禁用 |

Job 能 `cancel()`、`join()`，状态大致是 New、Active、Completing、Completed、Cancelling、Cancelled。`Deferred` 是能拿值的 Job。

Android 上的主人：

| Scope | 何时取消 | 适合 |
|-------|----------|------|
| `lifecycleScope` | 界面销毁。旋转会销毁界面 | 只跟这一次界面有关的收集、动画 |
| `viewModelScope` | `onCleared`。旋转时 ViewModel 还在 | 页面数据、和这次页面会话相关的请求 |
| `rememberCoroutineScope` | 离开组合 | 点击里启动的协程 |
| 自建 `CoroutineScope` | 你调用 `cancel()` | SDK 长连接，在 disconnect 时取消 |

## 原理

1. **结构化并发。** `launch` 出来的 Job 父级是当前 Scope 的 Job。父取消，子取消。子在普通 Job 下抛出非取消异常，父失败，兄弟也被取消。这样不会出现「页面没了，请求回调还在改 View」，也不会默认把失败藏起来。
2. **async 的异常时机。** `async` 里的异常先放在 Deferred 中。不 `await` 就暂时不在这一行抛出。若父级是普通 `coroutineScope`，这个失败仍然会让作用域失败并取消另一个 `async`。所以「不 await 就等于没异常」只对监督作用域成立，而且失败的协程自己已经结束了。
3. **coroutineScope 和 supervisorScope。** 两者都会等子协程结束才返回，这点和 `coroutineScope { }` 作为挂起函数的语义一致。差别只在失败隔离。两个接口都要、一个失败就整页失败，用 `coroutineScope`。推荐和消息两块互不影响，用 `supervisorScope`，并且每个子协程自己 try，否则异常变成未捕获。
4. **withContext 不创造兄弟。** 它是当前协程的一段。块里的代码和块后面的代码有明确的前后关系，适合「后台拿数据，回来更新状态」。需要并行时才用两个 `async`。不要 `launch` 两个任务再写共享变量，结束时机和异常都散了。
5. **Scope 的 Job 用 SupervisorJob 的原因。** `viewModelScope` 用 `SupervisorJob`，这样一个 `launch` 失败不会把整个 ViewModel 的协程范围拆掉，另一个 `launch` 还能跑。这和 `supervisorScope` 同一思想。你自己 `CoroutineScope(Dispatchers.Main)` 如果用普通 `Job()`，一个子失败会取消这个 Scope 里的所有后续工作。
6. **GlobalScope 没有主人。** 它不跟界面、不跟 ViewModel。进程还在它就可能还在。页面关闭后回调回来，就会更新已销毁的界面，或让加载器被协程抓住泄漏。测试里它还串数据。业务禁止。

离开页面仍要做完的上传，不要放 `viewModelScope`：退出页面会 `onCleared` 并取消。放到 SDK 自己的 Scope，或 WorkManager，并在真正完成或失败时结束。

## 使用与实践

并行请求：

```kotlin
suspend fun load() = coroutineScope {
    val a = async(Dispatchers.IO) { api.a() }
    val b = async(Dispatchers.IO) { api.b() }
    Page(a.await(), b.await())
}
```

只展示成功的一半时，换成 `supervisorScope`，各自 catch。串行依赖用 `withContext`，不要并行。

自建范围：`val job = SupervisorJob(); val scope = CoroutineScope(job + Dispatchers.Main.immediate)`。`disconnect()` 里 `job.cancel()`。不要忘记取消，否则和 GlobalScope 同类问题。

`runBlocking` 只放在单元测试和真正的程序入口。主线程、Binder 线程、锁里面都不要用它把挂起函数堵回去，容易和持锁线程形成环。

## 例子

```kotlin
class Session {
    private val job = SupervisorJob()
    val scope = CoroutineScope(job + Dispatchers.Main.immediate)

    fun refresh() = scope.launch {
        val page = withContext(Dispatchers.IO) { api.page() }
        render(page)
    }

    fun refreshParallel() = scope.launch {
        supervisorScope {
            launch { runCatching { api.feed() }.onSuccess { renderFeed(it) } }
            launch { runCatching { api.inbox() }.onSuccess { renderInbox(it) } }
        }
    }

    fun close() { job.cancel() }
}
```

`lifecycleScope.launchWhenStarted { }` 一类 API 在停止时只是挂起收集，旋转销毁仍会取消。和页面同生死的收集用 `repeatOnLifecycle`，避免在 STOPPED 之后还在跑，也避免只用 launch 却在后台继续收集。

## 画面

```text
viewModelScope (SupervisorJob + Main)
    launch ---- 子 Job，失败不拆掉整个 Scope
    launch ---- 另一个子 Job
onCleared -> 父 Job 取消 -> 两个子都收到取消

coroutineScope
    async a ----+
    async b ----+-- 一个失败，另一个被取消，异常抛出
```

## 常见坑与追问

1. **launch(IO) 的下一行就用结果。** 追问：和 withContext 差在哪？launch 是并行工单，withContext 做完才继续。
2. **两个 async 放在 viewModelScope 里不 await。** 追问：异常去哪了？Deferred 里。若没人 await，又不是监督结构，还可能把父 Scope 弄失败。要用 coroutineScope 包住并 await。
3. **上传放在 viewModelScope。** 追问：退出页面会怎样？onCleared 取消，上传中断。改放业务 Scope 或任务队列。
4. **自己建 Scope 用普通 Job，一个请求失败全部停。** 追问：viewModelScope 为什么不是这样？它的 Job 是 SupervisorJob。
