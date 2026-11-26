---
id: q-callback-to-suspend
type: qa
module: coroutine
knowledge_ref: kp-callback-to-suspend
title: 异步回调想同步拿结果怎么转挂起？
priority: P0
version: 1
---

## 问题
调用了异步回调方法，想在协程里按顺序拿到结果，应该怎么处理？有哪些 API，区别是什么？

## 答案
把回调包成一次挂起，写成顺序代码。这是「协程语义上的同步等待」，不是堵死线程。

| API | 区别 |
|-----|------|
| `suspendCancellableCoroutine` | **首选**。一次性回调；`invokeOnCancellation` 里取消请求 |
| `suspendCoroutine` | 不感知取消，一般别用 |
| `CompletableDeferred` + `await` | 多处/延迟 `complete`，再挂起等待 |
| `async`/`await` | 并行自己的挂起任务，不是包装外部回调 |
| `withContext(IO)` | 只有阻塞同步 API、没有回调时用 |
| `callbackFlow` | 多次回调/监听，不是一次性结果 |

```kotlin
suspend fun load(id: String): User =
    suspendCancellableCoroutine { cont ->
        val call = api.get(id, object : Callback {
            override fun onOk(u: User) = cont.resume(u)
            override fun onErr(e: Throwable) = cont.resumeWithException(e)
        })
        cont.invokeOnCancellation { call.cancel() }
    }
```

挂起续跑靠 Continuation（书签）、状态机 `label`、恢复时的 `result`；取消要接到底层，否则页面关了请求还在跑。
