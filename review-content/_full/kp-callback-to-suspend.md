---
id: kp-callback-to-suspend
type: knowledge
module: coroutine
title: 回调转挂起与 suspendCancellableCoroutine
priority: P0
version: 2
order: 60
requires: [kp-coroutine-basics]
---

## 一句话

要把「异步回调」写成顺序代码并拿到结果，用挂起把回调包住；首选 `suspendCancellableCoroutine`，并在取消时关掉底层请求。

## 组成与结构

| API | 作用 | 适合 | 注意 |
|-----|------|------|------|
| `suspendCancellableCoroutine` | 回调 → 一次挂起；可取消 | **一次性**成功/失败回调 | `invokeOnCancellation` 必须接 |
| `suspendCoroutine` | 同上，不感知取消 | 几乎不会取消的老 API | 协程取消了回调可能还在 |
| `CompletableDeferred` | 手动完成的 `Deferred` | 多处回调、先拿句柄再 `complete` | 只能完成一次；用 `await()` |
| `async` + `await` | 协程内自己开任务 | 并行多个**已是挂起**的任务 | **不**用来包外部回调 |
| `withContext(IO) { }` | 阻塞调用丢到 IO | 只有同步阻塞、没有回调 | 仍占一条 IO 线程 |
| `callbackFlow` | 多次回调 → Flow | 监听、进度、连续事件 | 一次性结果别用 |

挂起函数编译后大致靠这些「字段/要素」续跑：

| 要素 | 作用 |
|------|------|
| `Continuation` | 书签：从哪继续、结果往哪送 |
| `label` | 状态机停在第几步 |
| `result` | 恢复时带回的成功值或异常 |
| `COROUTINE_SUSPENDED` | 告诉调用方「我真的挂起了，先回去」 |

## 原理

1. **回调世界和协程世界不同步。** 回调在别的线程、别的时间点调用 `onSuccess`。协程要的是：跑到这里先停住，等回调来了再带着结果往下写。桥就是 Continuation：`resume` / `resumeWithException`。
2. **为什么优先 Cancellable。** 页面销毁会 `cancel` 协程。若只用 `suspendCoroutine`，底层 OkHttp/SDK 请求可能继续，回来还可能碰已销毁对象。`suspendCancellableCoroutine` 提供 `invokeOnCancellation`，在这里 `call.cancel()`。
3. **和 async 别混。** `async` 是协程里再开一张工单。`suspendCancellableCoroutine` 是把**外部已有的回调 API** 接进当前协程，并不多开一张「业务工单」语义上的兄弟任务（实现上仍是挂起当前协程）。
4. **CompletableDeferred。** 适合「先把 Deferred 交给别人，稍后在某个回调里 `complete`」。多个等待方都可以 `await` 同一个完成结果。注意不要 `complete` 两次。
5. **多次事件。** 定位更新、下载进度不是「一次 resume」模型，用 `callbackFlow`：`trySend` / `awaitClose { 反注册 }`。

## 使用与实践

```kotlin
suspend fun loadUser(id: String): User =
    suspendCancellableCoroutine { cont ->
        val call = api.getUser(id, object : Callback {
            override fun onSuccess(u: User) = cont.resume(u)
            override fun onError(e: Throwable) = cont.resumeWithException(e)
        })
        cont.invokeOnCancellation { call.cancel() }
    }

// 使用处像同步：
val user = loadUser("1")
show(user)
```

阻塞且无回调：

```kotlin
val bytes = withContext(Dispatchers.IO) { file.readBytes() }
```

## 例子

```kotlin
// 多处完成 → Deferred
fun fetchOnce(): Deferred<String> {
    val d = CompletableDeferred<String>()
    engine.start(
        onOk = { d.complete(it) },
        onErr = { d.completeExceptionally(it) },
    )
    return d
}

suspend fun use() {
    val text = fetchOnce().await()
}
```

## 画面

```text
协程跑到 suspendCancellableCoroutine
        │
        ▼ 登记回调，返回 SUSPENDED（挂起）
   线程去干别的工单
        │
回调 onSuccess ──► cont.resume(value)
        │
        ▼ 按 Dispatcher 恢复，下一行拿到 value

cancel 协程 ──► invokeOnCancellation ──► call.cancel()
```

## 常见坑与追问

1. **`resume` 调了两次。** 会崩或未定义。成功/失败分支互斥，或用 `cont.isActive` 判断。
2. **忘了 `invokeOnCancellation`。** 追问：页面关了请求还在不在？应该关掉。
3. **用 `async` 包回调。** 追问：async 解决的是并行挂起任务，不是回调桥接；桥接用 `suspendCancellableCoroutine`。
4. **把 `callbackFlow` 用在一次性登录回调。** 过重；一次性用 suspend 包装即可。
