---
id: q-bb9deddf
type: qa
module: coroutine
knowledge_ref: kp-callback-to-suspend
title: 异步回调怎么转成挂起、按顺序拿结果？
priority: P0
version: 1
---

## 问题
异步回调怎么转成挂起、按顺序拿结果？

## 答案
1. 首选 `suspendCancellableCoroutine`：`resume` / `resumeWithException`，并在 `invokeOnCancellation` 里取消底层请求。  
2. `suspendCoroutine` 不感知取消，一般不用。  
3. `CompletableDeferred`：多处/延迟完成，再 `await()`。  
4. `async` 解决的是并行挂起任务，不是包装外部回调。  
5. 只有阻塞无回调 → `withContext(Dispatchers.IO)`；多次事件 → `callbackFlow`。  
6. 续体要素：`Continuation`（书签）、`label`（停在哪一步）、`result`（恢复带回的值/异常）。

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

---
