---
id: kp-coroutine-cancel
type: knowledge
module: coroutine
title: 协程取消、异常与监督
priority: P0
version: 7
order: 50
requires: [kp-coroutine-builders]
---

## 一句话

`cancel()` 只把 Job 标成**取消中**；协程跑到下一个挂起点才抛 `CancellationException` 停下。取消异常是**正常结束信号**，不能当业务失败吃掉。

## 组成与结构

| 机制 | 作用 |
|------|------|
| `Job.cancel` | 请求取消（协作式） |
| 挂起点 | `delay`、`withContext`、挂起 IO 进入/恢复时检查 |
| `isActive` / `ensureActive` / `yield` | 无挂起点循环自查 |
| `CancellationException` | 取消展开方式；父默认不当失败 |
| `SupervisorJob` / `supervisorScope` | 一子失败不取消兄弟 |
| `CoroutineExceptionHandler` | 无人接住的异常；**不接取消** |
| `finally` / `invokeOnCompletion` | 锁、关流、反注册 |

**关系一句：** 父取消 → 所有子取消。普通父下子抛业务异常 → 父失败 → 兄弟取消。监督下该子自己失败，兄弟继续；未处理则走 CEH 或未捕获。

先修：`kp-coroutine-builders`。CEH 与上下文：`kp-coroutine-context`。

## 原理

### 1. 协作取消，不抢占字节码

**是什么：** 取消不会把线程砍在中间。挂起函数发现 Job 已取消就抛 `CancellationException`。纯 `while` 计算没有检查点，会一直转直到你 `ensureActive()`。

**看代码：**

```kotlin
val job = launch {
    while (true) {
        crc32(buffer)  // 停不下来
    }
}
job.cancel()

while (isActive) {
    ensureActive()
    crc32(buffer)
}
```

**和谁有关：** 挂起 vs 阻塞见 `kp-coroutine-basics`。

**别混：** `cancel()` **不等于**立刻停在当前行。

### 2. `CancellationException` 要先抛回去

**是什么：** 取消要走 `finally`/`use`，所以用异常展开。父不把这次当业务失败。`catch (Exception)` 会把它抓住，协程不再处于取消态，后面代码继续跑——父还以为已停干净。

**看代码：**

```kotlin
try {
    work()
} catch (e: CancellationException) {
    throw e
} catch (e: IOException) {
    _state.value = Err(e)
}
```

**和谁有关：** `TimeoutCancellationException` 是子类，超时 UI 可单独 catch，见本篇实践。

**别混：** 取消不是「失败」；CEH **故意忽略** `CancellationException`。

### 3. 阻塞 IO 让取消「迟到」

**是什么：** 标准挂起会查取消。`withContext(IO)` 里调用**不看中断**的阻塞读，取消停在外面，读返回后才在下一挂起点抛。

**看代码：**

```kotlin
withContext(Dispatchers.IO) {
    input.read(buf)  // 长阻塞：cancel 后要等 read 结束
    ensureActive()   // 或在循环 read 里查 isActive
}
```

**和谁有关：** 能换可取消 API 就换；否则 `interrupt` + 确认库行为。

**别混：** 这不是默认「一 cancel 就断 socket」。

### 4. 监督：兄弟互不拆，异常别漏地上

**是什么：** `supervisorScope` 里各 `launch` 自己 catch。监督**不**把失败变 `Result`；不 catch 就变未捕获，Android debug 常崩。

**看代码：**

```kotlin
supervisorScope {
    launch { runCatching { loadFeed() }.onFailure { showFeedError(it) } }
    launch { runCatching { loadInbox() }.onFailure { showInboxError(it) } }
}
```

**和谁有关：** `viewModelScope` 的监督父，见 `kp-coroutine-context`。

**别混：** `supervisorScope` ≠ 外层 `launch(SupervisorJob())` 换父；后者断结构化取消。

### 5. `launch` 异常：沿父链上，根上才 CEH

**是什么：** `launch` 无返回值可接异常。普通父**接手**孩子失败 → 兄弟取消 → 异常上传。传到根且一路无 catch → `CoroutineExceptionHandler`。handler 响时工单**已结束**，不能救活现场。

**看代码：**

```kotlin
val handler = CoroutineExceptionHandler { _, e -> log(e) }
scope.launch(handler) {
    throw RuntimeException("x")  // 父是 Supervisor 时 handler 可能收到
}
```

**和谁有关：** 内层 `coroutineScope { launch(handler) }` 时父是普通 Job，子 CEH **不响**，见 `kp-coroutine-context`。

**别混：** CEH 不是 try/catch，不能当重试现场。

### 6. `async`：异常在 Deferred，`await` 才交给调用方

**是什么：** 包住 `async { }` 的 try 没用——那一行立刻返回 `Deferred`。`try/catch` 要包 `await`。async 自带 CEH 基本不生效。但普通父下孩子一失败仍会取消兄弟，**不必等** `await`。

**看代码：**

```kotlin
try {
    val d = async { risky() }
    d.await()
} catch (e: Exception) {
    handle(e)
}
```

**和谁有关：** 并行又要各管失败 → `supervisorScope` + `await`/catch。

**别混：** 不 `await` 不会让异常进 CEH；可能父已被失败孩子弄挂。

### 7. `coroutineScope` 是结构化失败出口

**是什么：** 普通 Job 的挂起函数。任一子非取消异常 → 取消兄弟 → 从 `coroutineScope` **这一行**抛给调用方。调用方 catch 住就不算未捕获。

**看代码：**

```kotlin
suspend fun load() = coroutineScope {
    val a = async { api.a() }
    val b = async { api.b() }
    a.await() to b.await()
}
// 调用方 try { load() } catch ...
```

**和谁有关：** 优先把失败交给调用者，而不是根 CEH。

**别混：** `supervisorScope` 仍会**等**所有子结束；差别只在失败是否取消兄弟。

### 8. 取消时的清理与 `NonCancellable`

**是什么：** `finally` 走非挂起清理。清理本身要挂起（再写盘）用 `withContext(NonCancellable)` **只包那几行**；包整个函数等于屏蔽取消。

**看代码：**

```kotlin
try {
    useResource()
} finally {
    mutex.unlock()  // 取消也会进
}

withContext(NonCancellable) {
    flushLog()  // 仅这几行
}
```

**和谁有关：** `invokeOnCompletion` 适合 Job 级反注册，不依赖体执行到某行。

**别混：** `runCatching { }` 会把 `CancellationException` 收成 `Result.failure`。

## 使用与实践

### 长循环与 `runCatching`

**是什么：** 解析大文件按块 `ensureActive()`。不要用 `runCatching` 包整段而不重抛取消。

**看代码：**

```kotlin
viewModelScope.launch {
    try {
        longWork()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        _state.value = Err(e)
    }
}
```

**和谁有关：** 超时用 `withTimeout`；`TimeoutCancellationException` 单独转 UI 文案。

**别混：** 用户离开页面的取消 ≠ 超时错误，别合成同一种「加载失败」。

### 超时与别用 GlobalScope 逃取消

**是什么：** `withTimeout(ms)` 也是取消。子协程别 `GlobalScope.launch`「防被取消」——逃出结构化并发。真独立生命周期用有主人的 SDK Scope，在 `close()` 里 `cancel`。

**看代码：**

```kotlin
try {
    withTimeout(5_000) {
        withContext(Dispatchers.IO) { fetch() }
    }
} catch (e: TimeoutCancellationException) {
    _state.value = Err("超时")
} catch (e: CancellationException) {
    throw e
}
```

**和谁有关：** 多个孩子失败时第一个业务异常为主，其余 `suppressed`；取消透明。

**别混：** 超时若完全不 catch 漏出 `launch`，框架当取消不是 CEH 业务上报。

## 例子

带超时的 IO 读循环：`withTimeout` 外 catch 超时；`CancellationException` 重抛；`IOException` 变错误态。监督两块 feed/inbox 各 `runCatching`。

**错：** `runCatching { longWork() }` 把父级取消吃掉。  
**对：** 先 catch `CancellationException` 再处理业务。

## 画面

![普通父 Job 下失败会取消兄弟](./assets/diagrams/coroutine-cancel-job.svg?v=2)

```text
cancel() → 只改 Job 状态
    ↓
下一挂起点 / ensureActive → CancellationException
    ↓
finally / use → 资源释放 → 父不把这次当业务失败

catch (Exception) 吃掉取消 → 状态不再是取消，后面代码继续
```

## 常见坑与追问

1. **说 cancel 立刻停当前行。** 追问：紧循环？无挂起点，要 `ensureActive`。
2. **空 catch Exception。** 追问：取消为什么进来？先 `throw` 回去。
3. **`NonCancellable` 包整个函数。** 追问：Scope 结束也要等跑完，只包清理几行。
4. **超时和用户取消同一种错误文案。** 追问：超时是 `TimeoutCancellationException`；离开页面是普通取消。
5. **`launch(SupervisorJob())` 当等于 supervisorScope。** 追问：参数换父，外层 cancel 进不来，见 `kp-coroutine-context`。
6. **多个 async 只加 CEH 不 await。** 追问：异常在 Deferred；普通父仍会因失败孩子取消兄弟。