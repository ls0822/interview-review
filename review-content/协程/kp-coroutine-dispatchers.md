---
id: kp-coroutine-dispatchers
type: knowledge
module: coroutine
title: Dispatcher 与线程池选择
priority: P0
version: 7
order: 20
requires: [kp-coroutine-basics]
---

## 一句话

`Dispatcher` 决定协程恢复时在**哪一类线程**上跑。`launch { }` 不写参数就继承 Scope 背包里的那张；Android 的 `viewModelScope` 默认是**主线程**，不是 `Dispatchers.Default`。

## 组成与结构

| Dispatcher | 用在哪 | 背后 |
|------------|--------|------|
| `Main` | 改 View、收集 UI 状态 | Android 主线程 + Handler |
| `Main.immediate` | 已在主线程时少排一次队 | `lifecycleScope` / `viewModelScope` |
| `IO` | 可能阻塞的网络、磁盘、JDBC | 共享调度器，标记「阻塞」，并行度默认可到 ≥64 |
| `Default` | CPU 排序、解析、计算 | 同调度器，并行度约核数（至少 2） |
| `Unconfined` | 业务几乎不用 | 调用线程启动，挂起后留在**恢复它的**那条线程 |
| 自定义 | 限并发、要线程名 | `limitedParallelism` / `asCoroutineDispatcher()` |

**关系一句：** JVM 上 `Default` 与 `IO` 共用 `CoroutineScheduler`（线程名常 `DefaultDispatcher-worker-N`）；差别是任务标记——计算满了排队，IO 允许为阻塞再开线程。

先修：`kp-coroutine-basics`。上下文合并见 `kp-coroutine-context`；构建器见 `kp-coroutine-builders`。

## 原理

### 1. 背包里的 Dispatcher 会被继承

**是什么：** 协程上下文含 `Job` + `Dispatcher`。`launch` 不写调度器就用当前上下文里的；**没有** Dispatcher 时标准构建器才落 `Default`。

**看代码：**

```kotlin
viewModelScope.launch {  // 自带 Main.immediate
    delay(1)
    updateUi()           // 在主线程，不是 Default
}
CoroutineScope(Dispatchers.IO).launch {
    // 默认在 IO
}
```

**和谁有关：** `viewModelScope = SupervisorJob + Main.immediate`，见 `kp-coroutine-context`。

**别混：** 「协程默认 Default」只对**裸** `CoroutineScope()` / `GlobalScope`；Android 页面 Scope 默认 Main。

### 2. `withContext` 换的是当前工单，`launch` 是旁路工单

**是什么：** `withContext` 挂起 → 在目标 Dispatcher 跑块 → 块结束再挂起切回；下一行与块**串行**。`launch(IO)` 另开一张工单，与当前行**并行**，结果不会自动交到下一行。

**看代码：**

```kotlin
val x = withContext(Dispatchers.IO) { read() }
use(x)                    // 一定在 read 完成之后

launch(Dispatchers.IO) { read() }
use(x)                    // 错：不等待 IO
```

**和谁有关：** 并行两张工单用 `async`/`await`，见 `kp-coroutine-builders`。

**别混：** 要「拿结果再往下写」用 `withContext` 或 `await`，不是裸 `launch`。

### 3. `Main` 与 `Main.immediate`

**是什么：** `Main` 总是 `post` 到消息队列，哪怕你已在主线程。`immediate` 发现当前就是主线程则**直接跑**，少一次排队，顺序更可预期。

**看代码：**

```kotlin
// 已在主线程
withContext(Dispatchers.Main) { }        // 仍 post
withContext(Dispatchers.Main.immediate) { } // 当场执行
```

**和谁有关：** 在后台线程时两者都会切回主线程；差在「已在 Main 时」。

**别混：** `immediate` 是调度优化，**不是** Job，也不改异常语义。

### 4. IO 与 Default：场景别对调

**是什么：** 在 `Default` 上 `sleep`/阻塞 JDBC，会把约「核数」个计算工人占满，CPU 活堵住。在 `IO` 上大矩阵计算，占的是为阻塞准备的线程，真 IO 被饿死。

**看代码：**

```kotlin
// 错
withContext(Dispatchers.Default) { stmt.executeQuery() }
withContext(Dispatchers.IO) { fft(huge) }

// 对
withContext(Dispatchers.IO) { blockingRead() }
withContext(Dispatchers.Default) { parse(json) }
```

**和谁有关：** 阻塞占线根因见 `kp-coroutine-basics`。

**别混：** 共用调度器 ≠ 可以随意混场景；标记决定池子扩容策略。

### 5. `limitedParallelism` 不是新建 n 条 OS 线程

**是什么：** 限制**同时跑**的协程数，工人仍来自原 `IO`/`Default` 调度器。要真正 4 条专用线程并 `close()`，用 `Executors.newFixedThreadPool(4).asCoroutineDispatcher()`。

**看代码：**

```kotlin
val upload = Dispatchers.IO.limitedParallelism(2)
scope.launch(upload) { put(file) }

val named = Executors.newFixedThreadPool(4) { Thread(it, "im") }
    .asCoroutineDispatcher()
// 不用时 named.close()
```

**和谁有关：** 上传并发常配合 `Semaphore`，见实践段。

**别混：** IO 默认 64 是**并行度上限**，不是无界 `CachedThreadPool`；多于上限排队。

### 6. `Unconfined` 难推理

**是什么：** 在调用者线程启动；第一次挂起之后，在哪个线程恢复就留在哪——可能是定时器、OkHttp 回调线程，后续代码一路在那跑。

**看代码：**

```kotlin
launch(Dispatchers.Unconfined) {
    delay(1)              // 挂起后恢复线程不定
    textView.text = "?"   // 可能不在 Main
}
```

**和谁有关：** 与 `kp-coroutine-basics`「认 Dispatcher」——Unconfined 故意打破「回到原 Dispatcher」直觉。

**别混：** 库/API 不要默认 `Unconfined` 图省事。

## 使用与实践

### Android 常见分工

**是什么：** 收集 `StateFlow`、改 View → 留在 `viewModelScope`（已是 Main）。读库/文件/OkHttp `execute` → `withContext(IO)`。大 JSON 解析 → `withContext(Default)`。同时下载 ≤3 → `Semaphore(3)` 或 `IO.limitedParallelism(3)`。

**看代码：**

```kotlin
viewModelScope.launch {
    val raw = withContext(Dispatchers.IO) { api.blockingGet() }
    val parsed = withContext(Dispatchers.Default) { parse(raw) }
    _state.value = parsed
}
```

**和谁有关：** Scope 生命周期见 `kp-coroutine-builders`；`execute` vs `enqueue` 见 `kp-callback-to-suspend`。

**别混：** 已在 IO 的调用里再偷偷 `withContext(IO)` 嵌套，易藏耗时；SDK 文档要写清线程要求。

### OkHttp / 阻塞 SDK：工人选错就等于 ANR 或饿死池子

**是什么：** `client.newCall(...).execute()`、同步读文件、JDBC，本质是**占住当前线程**。放在 Main 协程里（哪怕函数标了 `suspend`）→ ANR。放进 `Default` → 计算工人被睡死/堵死。正确：关进 `Dispatchers.IO`（或挂起封装）。

**看代码：**

```kotlin
// 错：仍在 Main 上阻塞
viewModelScope.launch {
    val body = client.newCall(req).execute().body!!.string()
}

// 对：阻塞关进 IO；外层协程在 withContext 挂起，Main 可干别的
viewModelScope.launch {
    val body = withContext(Dispatchers.IO) {
        client.newCall(req).execute().use { it.body!!.string() }
    }
    bind(body)
}
```

**和谁有关：** 多请求并行用多个 `async(IO)`，见 `kp-coroutine-builders`。

**别混：** `withContext(IO)` 解决的是「别堵 Main」；`execute` 期间那条 IO 工人照样被占着——要「不占工人等网络」得用回调/`enqueue` 桥。

### 自定义 Dispatcher 要关门

**是什么：** `asCoroutineDispatcher()` 换来的池子不用时要 `close()`，否则线程泄漏。页面级工作不要用 `GlobalScope + Default` 冒充 Scope。

**看代码：**

```kotlin
val d = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
try {
    withContext(d) { /* ... */ }
} finally {
    d.close()
}
```

**和谁有关：** 长连接 SDK 自建 `SupervisorJob + Dispatcher`，在 `disconnect()` 里 `cancel()`。

**别混：** `limitedParallelism` 不需要你 `close` 原调度器；fixed pool 要。

## 例子

`viewModelScope.launch` 里 IO 读 raw、Default 解析、最后 `_state` 更新——三段 `withContext`，每段结束回到 Main，改状态安全。

**错：** `launch(IO) { x = read() }; use(x)`——下一行不等待。  
**对：** `val x = withContext(IO) { read() }; use(x)`。

## 画面

![Dispatcher 与 withContext 换线程](./assets/diagrams/coroutine-dispatchers.svg?v=2)

```text
viewModelScope 自带 Main.immediate
    withContext(IO)      → 标成阻塞的工人
    结束 → 回到 Main
    withContext(Default) → 计算工人
    结束 → 回到 Main，改状态

裸 launch(IO) = 旁路工单，与下一行并行
```

## 常见坑与追问

1. **认为协程默认都在 Default。** 追问：`viewModelScope.launch` 在哪？主线程。
2. **Default 里 sleep 或阻塞读库。** 追问：池子怎样？计算工人被占满。阻塞放 IO。
3. **`limitedParallelism` = 新建 n 线程。** 追问：和 fixed pool？前者限并行度、工人仍属原调度器；后者自有线程要 `close`。
4. **Unconfined 写在库里省事。** 追问：挂起后在哪跑？恢复它的那条线程，可能碰 View 崩溃。
