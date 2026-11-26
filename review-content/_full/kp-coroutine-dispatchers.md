---
id: kp-coroutine-dispatchers
type: knowledge
module: coroutine
title: Dispatcher 与线程池选择
priority: P0
version: 3
order: 20
requires: [kp-coroutine-basics]
---

## 一句话

Dispatcher 决定协程在哪一类线程上跑；`launch { }` 继承所在 Scope 的 Dispatcher，Android 的 `viewModelScope` 默认是主线程，不是 `Dispatchers.Default`。

## 组成与结构

| Dispatcher | 用在哪 | 背后 |
|------------|--------|------|
| `Main` | 改 View、收集合 | Android 主线程，经 Handler |
| `Main.immediate` | 已经在主线程时不再排队 | `lifecycleScope` / `viewModelScope` 用它 |
| `IO` | 阻塞式网络、磁盘、数据库 | 共享调度器上的「可能阻塞」任务，默认可扩到至少 64 |
| `Default` | 排序、解析、CPU 计算 | 同一套调度器，并行度大约等于核数，至少 2 |
| `Unconfined` | 几乎不用 | 在调用线程上开始，挂起后留在恢复它的那条线程 |
| 自定义 | 固定并发、要线程名 | `executor.asCoroutineDispatcher()` 或 `limitedParallelism` |

JVM 上 `Default` 和 `IO` 共用 `CoroutineScheduler`，线程名一般是 `DefaultDispatcher-worker-N`。差别是任务标记：Default 当计算，工人满了就排队；IO 当可能阻塞，池子允许再开线程，上限可用系统属性 `kotlinx.coroutines.io.parallelism` 调整。

`limitedParallelism(n)` 限制的是同时跑的协程数，不是新建一个 n 线程的操作系统池。要真正独立的 4 条线程并用完释放，用 `Executors.newFixedThreadPool(4).asCoroutineDispatcher()`，结束时 `close()`。

## 原理

1. **上下文里的 Dispatcher 会被继承。** 协程上下文是一组元素，包含 Job 和 Dispatcher。`launch` 不写参数时，用当前上下文里的那个。标准库的 `runBlocking` 和没有上下文的构建器才会落到 Default。AndroidX 的 `viewModelScope` 在创建时就放了 `SupervisorJob() + Dispatchers.Main.immediate`。所以里面裸写 `launch { delay(1); updateUi() }` 是在主线程，不会偷偷跑到计算池。
2. **withContext 切换的是当前这张工单。** 它挂起，到目标 Dispatcher 上执行块，块结束再挂起切回来。下一行一定发生在回来之后，和块里的代码没有并行。`launch(Dispatchers.IO)` 是另一张工单，和当前行并发，不会把结果交到下一行。
3. **immediate 为什么重要。** `Dispatchers.Main` 总是 `post` 到消息队列，即使你已经在主线程。`Main.immediate` 发现当前就是主线程就直接跑，少一次排队，也避免「先 post 再被别的消息插队」造成的重入顺序变化。已经在后台线程时，两者都会切回主线程。
4. **IO 和 Default 不要混用场景。** 在 Default 上调用 `Thread.sleep` 或阻塞 JDBC，会把大约「核数」那么多的计算工人睡死，CPU 活全堵住，而机器看起来很闲。阻塞 API 放 IO。反过来，在 IO 上做大计算会占着那些为阻塞准备的线程，把真正的 IO 饿到。计算放 Default，并用 `limitedParallelism` 卡住上限。
5. **Unconfined 难推理。** 它在调用者线程启动，第一次挂起之后，在哪个线程恢复就留在哪。可能是定时器线程、可能是 OkHttp 的回调线程，之后的代码就一直在那跑，包括不该碰的 View。业务不用它。
6. **和线程池参数的对应。** 讲 IO 默认 64 时，要能接上 ThreadPoolExecutor：这是并行度上限，不是无界 `newCachedThreadPool` 那种「来一个任务一条线程」直到内存爆。任务多于并行度就排队。你自己的上传若必须更小，不要假设 IO 已经帮你限成 4。

## 使用与实践

UI 收集 `StateFlow`、改 View：留在 `viewModelScope`，不要再套 `Main`。读库、读文件：`withContext(Dispatchers.IO)`。JSON 大对象解析：`withContext(Dispatchers.Default)`。同时下载不超过 3 个：`Semaphore(3)` 或 `Dispatchers.IO.limitedParallelism(3)`。

SDK 若暴露阻塞方法，在文档里写「不要在主线程调用」，内部帮调用方切 IO 要谨慎，避免把已经在 IO 上的调用再嵌套切一次却隐藏了耗时。

自定义 Dispatcher 一定要关闭，否则线程泄漏。不要用 `GlobalScope` 配 Default 去跑和页面同生命周期的工作。

## 例子

```kotlin
viewModelScope.launch {                 // Main.immediate
    val raw = withContext(Dispatchers.IO) { api.blockingGet() }
    val parsed = withContext(Dispatchers.Default) { parse(raw) }
    _state.value = parsed               // 回到 Main
}

val uploadDispatcher = Dispatchers.IO.limitedParallelism(2)
fun upload(file: File) {
    scope.launch(uploadDispatcher) { put(file) }
}

val named = Executors.newFixedThreadPool(4) { r ->
    Thread(r, "im-send")
}.asCoroutineDispatcher()
// 关闭：named.close()
```

`launch(Dispatchers.IO) { x = read() }; use(x)` 是错的：`use(x)` 不会等 IO 完成。要等就 `withContext` 或 `async`/`await`。

## 画面

![Dispatcher 与 withContext 换线程](./assets/diagrams/coroutine-dispatchers.svg)

```text
viewModelScope 自带 Main.immediate
    withContext(IO)     -> 共享池里标成阻塞的工人
    块结束
    withContext(Default)-> 大约核数的计算工人
    块结束
    回到 Main，改状态

裸 launch(IO) 是旁路工单，和下一行并行
```

## 常见坑与追问

1. **认为协程默认都在 Default。** 追问：`viewModelScope.launch` 在哪？主线程。只有上下文里没有 Dispatcher 时标准构建器才用 Default。
2. **在 Default 里 sleep 或阻塞读库。** 追问：池子会怎样？计算工人被占满，其他 CPU 协程排队。阻塞放 IO。
3. **limitedParallelism 说成新建了 n 条线程。** 追问：那和 fixed thread pool 差在哪？前者限制并行度，工人仍来自原调度器；后者是你拥有的线程，要自己 close。
4. **Unconfined 写在库里图省事。** 追问：挂起恢复后在哪跑？在恢复它的那条线程，可能把 UI 写到后台线程。
