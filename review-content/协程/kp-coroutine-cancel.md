---
id: kp-coroutine-cancel
type: knowledge
module: coroutine
title: 协程取消、异常与监督
priority: P0
version: 1
---

## 一句话

`cancel()` 只把 Job 标成取消中，协程跑到下一个挂起点才抛 `CancellationException` 停下来；取消异常是正常结束信号，不能当业务失败吃掉。

## 组成与结构

取消相关的几块要放在一张图里：

| 机制 | 作用 |
|------|------|
| `Job.cancel` | 请求取消，协作式 |
| 挂起点 | `delay`、`withContext`、挂起的 IO 在进入和恢复时检查取消 |
| `isActive` / `ensureActive` / `yield` | 没有挂起点的循环自己查 |
| `CancellationException` | 取消的展开方式，父协程默认不把它当失败 |
| `SupervisorJob` / `supervisorScope` | 一个孩子失败，不取消兄弟 |
| `CoroutineExceptionHandler` | 处理没人接住的异常，接不住取消的设计讨论 |
| `finally` / `invokeOnCompletion` | 放锁、关流、反注册 |

父子规则：父取消，所有子取消。普通父 Job 下，一个子抛出普通异常，父失败，兄弟取消。监督关系里，这个子自己失败，兄弟继续，异常如果没在子内部处理，会走上下文里的异常处理器。

`async` 把异常放在 Deferred 里，`await` 才抛。父若是普通 `coroutineScope`，失败仍会取消兄弟，不需要等到 await。

## 原理

1. **协作而不是抢占。** 取消不会把线程打断在任意字节码。挂起函数发现 Job 已取消，就不再继续等待，抛出 `CancellationException`。纯计算的 `while (true) { crc32(buffer) }` 没有检查点，会一直转。写成 `while (isActive)` 并在每圈 `ensureActive()`，标记才会生效。
2. **CancellationException 为什么是异常。** 它要展开栈，让 `finally` 和 `use` 执行。框架把它当成「这条协程正常停了」。`catch (e: Exception)` 会把它抓住，协程就不再处于取消状态，后面的代码继续跑，父协程还以为取消已完成。正确写法是先 `catch (e: CancellationException) { throw e }`，再处理业务异常。
3. **withContext 与阻塞 IO。** 标准挂起函数会检查取消。你在 `withContext(IO)` 里调用不看中断的阻塞读，取消请求会停在外面，读返回后才在挂起点抛出。能换成支持取消的 API 就换。否则在循环读里看 `isActive`，或让阻塞点响应 `interrupt`，并确认库会在取消时去中断那条线程。这不是默认行为。
4. **监督隔离失败。** 页面上两块数据互不影响：`supervisorScope` 里各自 `launch` 并自己捕获。不要在监督作用域外面再包一层会把异常传上来的逻辑却没人处理，否则会打到全局异常处理器，debug 时直接崩。
5. **异常处理器的位置。** `CoroutineExceptionHandler` 只处理没有结构化父协程接住的异常，例如根上 `launch` 的失败。它救不了 `async` 里没 await 的设计错误，也不是给取消用的。业务失败优先在协程内部变成 `Result` 或错误状态，而不是靠全局 handler 弹 Toast。
6. **取消时的清理。** `finally` 里可以做非挂起的清理。若清理本身要挂起（再写一次磁盘），需要 `withContext(NonCancellable)`，并且只包住这几行，否则等于把取消屏蔽掉，外层永远等你。`use` 和 `mutex.withLock` 的释放放在 finally 路径上，取消也会走。

资源用 `invokeOnCompletion` 适合注册在 Job 上的反注册，不依赖协程体一定执行到某一行。

## 使用与实践

每个不会马上结束的循环都要有检查点。解析大文件时按块 `ensureActive()`。

不要用 `runCatching` 包住一整段协程却不重新抛取消。它的 `catch` 范围包含 `CancellationException`。

超时用 `withTimeout(ms)`。超时也是取消，会抛 `TimeoutCancellationException`，它是 `CancellationException` 的子类。业务若要把超时显示成错误，在这一层单独捕获超时类型，不要捕获所有取消。

子协程不要 `GlobalScope.launch` 去「防止被取消」。那是逃出结构化并发。真要独立生命周期，用有主人的 SDK Scope，并在文档写的那个 `close()` 里取消。

## 例子

```kotlin
viewModelScope.launch {
    try {
        withTimeout(5_000) {
            val bytes = withContext(Dispatchers.IO) {
                openStream().use { input ->
                    val out = ByteArrayOutputStream()
                    val buf = ByteArray(8 * 1024)
                    while (true) {
                        ensureActive()
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                    }
                    out.toByteArray()
                }
            }
            _state.value = Ok(bytes)
        }
    } catch (e: TimeoutCancellationException) {
        _state.value = Err("超时")
    } catch (e: CancellationException) {
        throw e
    } catch (e: IOException) {
        _state.value = Err(e.message ?: "io")
    }
}
```

监督：

```kotlin
supervisorScope {
    launch { runCatching { loadFeed() }.onFailure { showFeedError(it) } }
    launch { runCatching { loadInbox() }.onFailure { showInboxError(it) } }
}
```

这里的 `runCatching` 若用在会取消的子协程里，仍要把 `CancellationException` 排除，否则父级取消时子协程把取消吃掉，表现为「取消不干净」。

## 画面

```text
cancel()
  只改 Job 状态
     |
下一个挂起点 / ensureActive
     |
抛 CancellationException
     |
finally / use 关闭资源
     |
协程结束。父级不把这次当业务失败

若 catch (Exception) 吃掉：状态不再是取消，后面的代码继续
```

## 常见坑与追问

1. **说 cancel 会立刻停在当前行。** 追问：紧循环为什么停不下来？没有挂起点。要 `ensureActive`。
2. **空 catch Exception。** 追问：取消为什么也进这个 catch？它继承 Exception。先抛回去。
3. **withContext(NonCancellable) 包住整个函数。** 追问：会怎样？取消被屏蔽，Scope 结束也要等这段跑完。只包清理那几行。
4. **超时和用户取消显示成同一种错误。** 追问：异常类型差在哪？超时是 `TimeoutCancellationException`。用户离开页面是普通取消，不应该弹「加载失败」。
