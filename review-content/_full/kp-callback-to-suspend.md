---
id: kp-callback-to-suspend
type: knowledge
module: coroutine
title: 回调转挂起与 suspendCancellableCoroutine
priority: P0
version: 5
order: 60
requires: [kp-coroutine-basics, kp-coroutine-cancel]
---

## 一句话

要把「一次回调给结果」写成从上往下拿返回值，用挂起桥住回调；首选 **`suspendCancellableCoroutine`**，并在协程取消时**关掉底层请求**。  
只有 **`execute()` 这类阻塞、没有回调** 时，用 `withContext(IO)` 即可——那是占 IO 工人干等，不是续体挂起。

## 组成与结构

| API | 干什么 | 适合 |
|-----|--------|------|
| `suspendCancellableCoroutine` | 回调 → 一次挂起；感知取消 | **一次性**成功/失败 |
| `suspendCoroutine` | 同上，不感知取消 | 老 API，几乎不用 |
| `CompletableDeferred` | 手动完成的 `Deferred` | 多处回调、先拿句柄再 `complete` |
| `async` + `await` | 协程里再开工单 | 并行**已是挂起**的任务 |
| `withContext(IO)` | 同步阻塞丢 IO | 无回调只有阻塞 |
| `callbackFlow` | 多次回调 → Flow | 监听、进度、连续事件 |

**关系一句：** 桥的核心是 `Continuation.resume` / `resumeWithException`；恢复时按上下文 `Dispatcher` 派发，**resume 可在任意线程调**。

先修：`kp-coroutine-basics`、`kp-coroutine-cancel`。构建器边界：`kp-coroutine-builders`。

## 原理

### 1. 两个时间线：用 Continuation 对齐

**是什么：** 回调在别的线程、别的时刻调用 `onSuccess`。协程要：跑到这里停住，回调来了带着结果继续。`resume` 把结果塞进书签。

**看代码：**

```kotlin
suspend fun loadUser(id: String): User =
    suspendCancellableCoroutine { cont ->
        api.getUser(id, object : Callback {
            override fun onSuccess(u: User) = cont.resume(u)
            override fun onError(e: Throwable) = cont.resumeWithException(e)
        })
    }
```

**和谁有关：** 状态机/`COROUTINE_SUSPENDED` 见 `kp-coroutine-basics`。

**别混：** 桥接不是把回调线程变成「协程线程」，是**把结果交回**协程调度。

### 2. 为何优先 Cancellable

**是什么：** 页面 `cancel` 协程后，`invokeOnCancellation` 里应 `call.cancel()`。只用 `suspendCoroutine` 时底层请求可能继续，回来碰已销毁对象。

**看代码：**

```kotlin
suspendCancellableCoroutine { cont ->
    val call = api.getUser(id, callback)
    cont.invokeOnCancellation { call.cancel() }
}
```

**和谁有关：** 协作取消见 `kp-coroutine-cancel`。

**别混：** 取消时 `cont.isActive == false`，应不 resume 或 `cont.cancel()`。

### 3. 和 `async` 别混职责

**是什么：** `async` 在协程里**再开一张工单**（并行）。`suspendCancellableCoroutine` 把**外部已有回调 API** 接进**当前**工单，语义上应是 `suspend fun`，不是用 `async` 包一层再 `await`。

**看代码：**

```kotlin
// 能跑但语义偏：应是 suspend fun load(): User = suspendCancellableCoroutine { ... }
scope.async { suspendCancellableCoroutine<User> { ... } }.await()
```

**和谁有关：** 并行多个挂起任务才 `async`，见 `kp-coroutine-builders`。

**别混：** async 解决并行，不解决「老 SDK 只有回调」。

### 4. `CompletableDeferred`：句柄先交出去

**是什么：** 多处或先启动引擎再在回调里 `complete` / `completeExceptionally`。只能完成**一次**；等待方 `await()`。

**看代码：**

```kotlin
fun fetchOnce(): Deferred<String> {
    val d = CompletableDeferred<String>()
    engine.start(
        onOk = { d.complete(it) },
        onErr = { d.completeExceptionally(it) },
    )
    return d
}
```

**和谁有关：** 与 `async` 不同——Deferred 由你手动完成，不是协程体自动跑完。

**别混：** 第二次 `complete` → `IllegalStateException`。

### 5. 多次事件用 `callbackFlow`

**是什么：** 定位、进度不是「resume 一次」。`trySend` 推元素；`awaitClose { 反注册 }` 在取消/收尾时卸载监听。

**看代码：**

```kotlin
fun locationUpdates(): Flow<Location> = callbackFlow {
    val cb = LocationCallback { trySend(it) }
    manager.register(cb)
    awaitClose { manager.unregister(cb) }
}
```

**和谁有关：** 背压与 `trySend` 失败见 `kp-coroutine-flow`。

**别混：** 一次性登录回调用 Flow 过重；`first()` 能凑合但不如 suspend 包装。

### 6. 只 resume 一次；线程交给 Dispatcher

**是什么：** 成功/失败互斥。竞态用 `tryResume`（false = 已 resume 或已取消）。resume 可在 OkHttp 线程；恢复后按上下文 Dispatcher 跑——立刻改 View 仍要保证最终在 Main（resume 数据 + Main collect 更安全）。

**看代码：**

```kotlin
override fun onSuccess(u: User) {
    if (cont.isActive) cont.resume(u)
}
// 双路径各 resume → 非法
```

**和谁有关：** `Dispatchers.Main` 见 `kp-coroutine-dispatchers`。

**别混：** 在回调线程直接 `textView.text =` 可能崩溃。

### 7. `suspendCoroutine` 的生命周期坑

**是什么：** 协程取消后回调仍可能 `resume`，续体可能已无效。除非确定回调生命周期覆盖整段挂起，否则一律 Cancellable。

**看代码：**

```kotlin
// 避免
suspendCoroutine { cont -> api.call(cont::resume) }
// 默认
suspendCancellableCoroutine { cont -> ...; cont.invokeOnCancellation { ... } }
```

**和谁有关：** 与取消「协作」一致。

**别混：** 「老代码能跑」≠ 页面销毁安全。

## 使用与实践

### 包一次性回调

**是什么：** `suspendCancellableCoroutine` + 回调里 `resume`/`resumeWithException` + `invokeOnCancellation` 关请求。使用处像同步：`val user = loadUser("1")`。挂起的仍是**调用这条 suspend 的协程**。

**看代码：**

```kotlin
suspend fun loadUser(id: String): User =
    suspendCancellableCoroutine { cont ->
        val call = api.getUser(id, object : Callback {
            override fun onSuccess(u: User) = cont.resume(u)
            override fun onError(e: Throwable) = cont.resumeWithException(e)
        })
        cont.invokeOnCancellation { call.cancel() }
    }
```

**和谁有关：** Repository 层包 SDK，ViewModel 里 `viewModelScope.launch { ... }` 调 suspend。见 `kp-coroutine-basics`。

**别混：** 只有同步阻塞、无回调 → `withContext(IO)` 够了，仍占一条 IO 工人。

### OkHttp：`execute` 阻塞 vs `enqueue` 挂起

**是什么：** `execute()` 在当前线程阻塞到响应回来——必须关进 `Dispatchers.IO`，否则主线程 ANR；协程在 `withContext` 处挂起，但 IO 工人仍被 `execute` 占着。`enqueue` + `suspendCancellableCoroutine` 才是「不占工人干等」，取消时可 `call.cancel()`。

**看代码：**

```kotlin
// A. 阻塞式（常见、简单）
suspend fun userBlocking(id: String): User = withContext(Dispatchers.IO) {
    client.newCall(req(id)).execute().use { parse(it) }
}

// B. 回调式挂起（可取消底层 Call）
suspend fun userEnqueue(id: String): User =
    suspendCancellableCoroutine { cont ->
        val call = client.newCall(req(id))
        call.enqueue(object : Callback {
            override fun onResponse(c: Call, r: Response) {
                runCatching { parse(r) }
                    .fold({ cont.resume(it) }, { cont.resumeWithException(it) })
            }
            override fun onFailure(c: Call, e: IOException) {
                cont.resumeWithException(e)
            }
        })
        cont.invokeOnCancellation { call.cancel() }
    }
```

**和谁有关：** 多接口串行/并行见 `kp-coroutine-builders`；阻塞占哪类池见 `kp-coroutine-dispatchers`。

**别混：** 在 `suspend fun` 里直接 `execute()` 且仍在 Main → 标了 suspend 也照样卡界面。

### 选型：一张表决策

**是什么：** 一次结果 → suspend 包装。多次推送 → `callbackFlow`。先拿 Deferred 句柄 → `CompletableDeferred`。并行已是 suspend → `async`。

**看代码：**

```kotlin
val bytes = withContext(Dispatchers.IO) { file.readBytes() }  // 无回调
val locs = locationUpdates()  // Flow
```

**和谁有关：** 不要把 `callbackFlow` 当「简化版 suspend」写一次性 API。

**别混：** `callbackFlow` + `first()` 登录一次 — 能写但语义重。

## 例子

`cacheHit` 分支里如果两条路径都 `resume` 同值 → **双 resume** 非法。取消后仍 `resume` → 应查 `isActive`。`async` 包外部回调 → 语义应是 suspend 函数。一次性登录用 Flow + `first()` → 过重。

**错：** 回调里直接改 View。  
**对：** resume 数据，Main 上 collect / 更新 `StateFlow`。

## 画面

```text
协程跑到 suspendCancellableCoroutine
        │
        ▼ 登记回调，COROUTINE_SUSPENDED
   工人去干别的工单
        │
回调 onSuccess ──► cont.resume(value)
        │
        ▼ 按 Dispatcher 恢复，下一行拿到 value

cancel 协程 ──► invokeOnCancellation ──► call.cancel()
```

## 常见坑与追问

1. **`resume` 两次。** 成功/失败互斥；分支里别各调一次。
2. **忘了 `invokeOnCancellation`。** 追问：页面关了请求还在？要 cancel 底层。
3. **用 `async` 包回调。** 追问：并行挂起 vs 外部回调桥 — 后者用 suspend 包装。
4. **一次性登录用 `callbackFlow`。**
5. **OkHttp 回调里改 View。** 追问：回调线程？可能非 Main；resume 数据到 VM。
6. **`CompletableDeferred` complete 两次。** 追问：第二次？`IllegalStateException`。
7. **`execute()` 写在 Main 协程的 suspend 里。** 追问：谁在阻塞？线程；suspend 救不了，要 `withContext(IO)` 或 enqueue 桥。
8. **两个接口都写成 suspend 就以为并行。** 顺序 `execute` 仍串行；并行要 `async`，见 `kp-coroutine-builders`。