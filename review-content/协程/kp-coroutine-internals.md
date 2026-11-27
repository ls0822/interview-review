---
id: kp-coroutine-internals
type: knowledge
module: coroutine
title: 挂起实现：状态机、CPS 与续体拦截
priority: P1
version: 5
order: 100
requires: [kp-coroutine-basics]
---

## 一句话

`suspend` 不是冻住线程：编译器把函数改成带 `Continuation` 的**状态机**。真挂起时返回哨兵 `COROUTINE_SUSPENDED` 并退栈——停的是**当前这条协程调用链**；恢复时由 Dispatcher 决定线程，**不保证还是原来那条**。无挂起点则走快路径，像普通函数一样跑完。

## 组成与结构

| 零件 | 管什么 |
|------|--------|
| 隐藏 `Continuation` 参数 | 每个 `suspend` 多出来的「做完找谁」 |
| 状态机对象 | 实现 `Continuation`，跨挂起活着；`label` + 字段 |
| `COROUTINE_SUSPENDED` | 真挂起哨兵；调用方必须原样上传 |
| `completion` | 本函数结束时恢复的外层续体 |
| `ContinuationInterceptor` | 包住续体，`resume` 派发到正确线程 |
| `suspendCancellableCoroutine` | 手写续体；取消用 `CancellationException` 恢复 |

**关系一句：** 挂起时 JVM 栈退出，「下一行」在**续体链**上；Dispatcher 只改**何时何地**调用 `resumeWith`，不改业务含义。

先修：`kp-coroutine-basics`。调度落地：`kp-coroutine-dispatchers`。桥接：`kp-callback-to-suspend`。

## 原理

### 1. 为什么必须是状态机

**是什么：** 挂起时线程要去跑别的协程，原栈帧不能留着。编译器把挂起点之间的代码切成状态；进函数看 `label` 从哪继续。

**看代码：**

```kotlin
suspend fun load(): String {
    val a = fetchA() // label 0→1，再调下层 suspend
    val b = fetchB()
    return a + b
}
// 变换后：一次调用一份状态机，多次挂起复用同一对象
```

**和谁有关：** 局部变量要跨挂起点 → 变成状态机字段；不跨的可留栈上。

**别混：** 不是每个挂起点各 new 一个状态机。

### 2. 快路径 vs 慢路径（哨兵）

**是什么：** JVM 可见返回 `Any?`：普通值 = 没挂起；`=== COROUTINE_SUSPENDED` = 已挂起，调用方不许读「业务返回值」。

**看代码：**

```kotlin
suspend fun maybe(): Int {
    cache.get()?.let { return it } // 快路径，栈上直接返回
    return remote()                 // 这里才可能哨兵
}
```

**和谁有关：** `delay` 非正、`Deferred` 已完成都可快路径。

**和谁有关：** 纯计算 `suspend`、挂起的是调用方协程，见 `kp-coroutine-basics`。

**别混：** 源码签名 `suspend fun` 不等于「每次都会挂起」，更不等于「自动开线程 / 自动并行」。

### 3. `result` 里既有值也有异常

**是什么：** `resumeWith(Result)` 放进 `result`；每个挂起点恢复后先把失败**重新抛出**，所以 `delay()` 外的 `try/catch` 仍包得住。

**看代码：**

```kotlin
try {
    withContext(Dispatchers.IO) { error("x") }
} catch (e: Throwable) { } // 恢复后在状态里抛出，catch 仍有效
```

**和谁有关：** 异常不是从另一线程栈顶凭空冒出。

**别混：** 写在回调线程里、`resume` 之外的代码，仍在回调线程。

### 4. 续体链代替调用栈

**是什么：** 状态机有 `completion` 指外层续体。挂起期间返回地址在对象链上，等待中协程占小块堆对象，不占默认线程栈。

**口述手势：** 手指从上到下点「外层 → 内层 → 挂起」，栈空了，书签在续体对象上。

**和谁有关：** `kp-coroutine-basics` 里「书签」隐喻。

**别混：** 快路径不挂起时仍是普通嵌套调用，栈该多深还多深。

### 5. 拦截发生在 `resume`

**是什么：** `interceptContinuation` 包成 `DispatchedContinuation`；`resume` 时 `isDispatchNeeded`：要则 `dispatch` 到池/Main，不要则当前线程直接进状态机。

**看代码：**

```kotlin
// 回调里 resume 的是已 intercept 的 cont
// 业务代码写在挂起点之后 → 跑在 Main/Default，不是回调线程
```

**和谁有关：** `Main.immediate`：`isDispatchNeeded` 为 false 时可同步跑完 `launch` 块开头。

**别混：** 「在回调里 `resume` 后立刻改 UI」若写在回调线程、挂起点之前，仍错线程。

### 6. 恢复为什么不保证同线程

**是什么：** 结果常在别的线程备好（定时器、OkHttp）。`Default`/`IO` 从池取工人，挂起前后可能是不同 worker。`Main` 像「同线程」只因主线程只有一条。

**看代码：**

```kotlin
launch(Dispatchers.Default) {
    val t = Thread.currentThread()
    delay(1)
    println(Thread.currentThread() === t) // 允许 false
}
```

**和谁有关：** `Unconfined`：无拦截时谁在 `resume` 就留谁的线程。

**别混：** `Unconfined` 不是「不切线程」，是「不替你纠正回来」。

### 7. `yield` 与 `delay(0)`

**是什么：** `delay(<=0)` 直接 return，不挂起、不检查取消。`yield()` 先 `ensureActive()`，再通过拦截续体让出调度；同调度器只剩自己时可能不真挂起。

**看代码：**

```kotlin
while (pending.isNotEmpty()) {
    step(pending.removeFirst())
    yield() // 主线程穿插其他任务 + 检查取消
}
// delay(0) 换 yield → 循环仍同步占着
```

**和谁有关：** 官方反模式：用 `yield` 赌别的协程先写完 `var`；要等用 `join`/`await`/`receive`。

**别混：** `delay(0)` 不是排到队尾；不是取消点。

### 8. 同线程协作 vs OS 抢占

**是什么：** 状态机一次只被一个调度任务进入；两次挂起之间不会劈到两条线程跑同一协程。但 OS 可抢占线程时间片，**不会**因此让同 Dispatcher 上别的协程插队——要靠挂起点或 `yield`。

**看代码：**

```kotlin
// Main 上紧循环无挂起点 → 掉帧，yield 也救不了 CPU 重活
// CPU 重活 → Default，不是主线程疯狂 yield
```

**和谁有关：** `Main`/`limitedParallelism(1)` 上 `var` 靠挂起点间不交错；`Default` 上要 `Mutex`。

**别混：** 协程切换不加锁，也不建 happens-before 魔法。

### 9. 普通函数不能调 `suspend`

**是什么：** 普通函数没有隐藏 `Continuation`，编译器无法上传哨兵。`launch`/`async`/`runBlocking` 在非挂起世界造初始续体。

**看代码：**

```kotlin
// 错：fun foo() { delay(1) }
viewModelScope.launch { delay(1) } // 对
```

**和谁有关：** `runBlocking` 占住当前线程事件循环；Android 主线程上 `runBlocking` + `withContext(Main)` 经典死锁。

**别混：** 不是运行时检查，是类型系统「颜色」。

### 10. 取消插进续体

**是什么：** `suspendCancellableCoroutine` 登记到 Job；取消时若未恢复，用 `CancellationException` 恢复并 `invokeOnCancellation` 释资源。`resume` 两次 → `IllegalStateException`。

**看代码：**

```kotlin
suspend fun firstOne() = suspendCancellableCoroutine { cont ->
    val call = enqueue { v, err -> /* resume 一次 */ }
    cont.invokeOnCancellation { call.cancel() }
}
```

**和谁有关：** `kp-callback-to-suspend`。`suspendCoroutine` 不登记取消，Job 已取消仍等回调。

**别混：** 回调与取消谁先到，只允许一个胜出。

### 11. `inline` / `runCatching` 边界

**是什么：** `inline suspend` 状态机嵌调用点。lambda 要逃逸则 `noinline`。`runCatching` 内联 `catch` 可能把 `CancellationException` 收成 `Result.failure`，协程继续跑。

**看代码：**

```kotlin
runCatching { longSuspendWork() } // 可取消块里慎用
// 失败时：if (e is CancellationException) throw e
```

**别混：** `coroutineScope`/`withContext` 边界不能为省分配硬内联掉。

## 使用与实践

### 业务层：控制挂起点，不写状态机

**是什么：** 循环里有没有 `ensureActive`/`yield`；阻塞有没有关进 IO；回调有没有可取消续体。

**和谁有关：** 读反编译用三问：`label` 对应哪次挂起后？`result` 值还是异常？返回哨兵还是最终结果？

**别混：** `label` 编号不是 API。

### 切线程用 `withContext`

**是什么：** 挂起、派发、再恢复到调用方拦截器。手写 `handler.post` + 返回未准备好值会破约定。

**看代码：**

```kotlin
withContext(Dispatchers.IO) { read() }
```

**别混：** 不要用 `delay(0)` 修主线程卡死。

### 启动模式与 immediate

**是什么：** `UNDISPATCHED` / `Main.immediate` 让开头跑在调用者线程，直到第一个真挂起点。默认 `launch` 先派发。

**看代码：**

```kotlin
viewModelScope.launch { /* 主线程调用时，开头可能同步执行 */ }
```

**和谁有关：** `kp-coroutine-context`。

**别混：** 内联不当第一性能手段；先对取消与线程边界。

## 例子

`runBlocking` 里三条约定（对照，不重复单元代码全文）：

**对：** `delay(1)` 后 Default 上线程可换。  
**错：** 主线程 `runBlocking` 里再要 Main。  
**错：** 普通 `foo()` 里写 `delay()`。

`firstOne`：恢复走拦截器，调用方在自家 Dispatcher，不在 `enqueue` 回调线程。

## 画面

```text
suspend 调用 → 状态机 label
内层返回 COROUTINE_SUSPENDED？
  是 → 哨兵上传，栈退出
  否 → 当前栈继续

resumeWith → DispatchedContinuation
  isDispatchNeeded → dispatch 到池/Main
  否 → 直接进状态机

最终非哨兵 → resume 外层 completion
```

## 常见坑与追问

1. **挂起 = 保存内核栈。** 追问：局部变量在哪？状态机字段；栈已退。
2. **`suspend` 一定挂起。** 追问：快路径、`delay(0)`。
3. **在回调线程 `resume` 后改 UI。** 追问：改在挂起点之后、经拦截器到 Main。
4. **`yield` 后对方肯定写完。** 反模式；用 `join`/`await`。
5. **`delay(0)` 排队尾。** 非正延迟直接 return；让出用 `yield`。
6. **主线程紧循环 `yield` 治掉帧。** CPU 重活用 `Default`。
7. **仓库层 `runBlocking` 很方便。** 追问谁持主线程？死锁风险。
8. **`inline` 就没有 Continuation。** 嵌进调用方，约定还在；`runCatching` 吞取消。
9. **手写续体 `resume` 两次。** 成功/失败/取消只允许一次；取消时停底层请求。
