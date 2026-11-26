---
id: kp-coroutine-internals
type: knowledge
module: coroutine
title: 挂起实现：状态机、CPS 与续体拦截
priority: P1
version: 3
order: 100
requires: [kp-coroutine-basics]
---

## 一句话

`suspend` 不是把线程冻住，而是编译器把函数改写成带 `Continuation` 的状态机：真挂起时返回哨兵 `COROUTINE_SUSPENDED` 并退栈，恢复时由 `ContinuationInterceptor`（通常就是 Dispatcher）决定在哪条线程上再进入这个状态机。所以恢复不保证还是原来那条线程。

## 组成与结构

直接风格的函数靠 JVM 调用栈记住「下一行是谁」。CPS（Continuation-Passing Style，延续传递）把「下一行」变成参数：函数做完不 return 到调用者的栈帧，而是调用一个续体。协程的挂起是这套风格的编译结果，再加一个约定：如果现在结果还没有，就先返回一个哨兵，稍后再调用续体。

和面试相关的几块：

| 东西 | 角色 |
|------|------|
| 隐藏的 `Continuation` 参数 | 每个 `suspend` 函数都多出来的「做完之后找谁」 |
| 状态机对象 | 实现 `Continuation`，活过挂起，里面是标签和跨挂起点的局部变量 |
| `label` | 下次从哪个挂起点之后继续 |
| `result` | 这次恢复带来的成功值或异常 |
| `COROUTINE_SUSPENDED` | 哨兵单例：这次真的挂起了，调用方不许读返回值，必须把哨兵继续往上传 |
| `completion` | 本函数真正结束时要恢复的外层续体 |
| `ContinuationInterceptor` | 包住续体，把 `resume` 派发到正确的线程 |
| `suspendCancellableCoroutine` | 手写续体时用的版本，取消会立刻以 `CancellationException` 恢复 |

状态机是一次调用一份，不是每个挂起点各 new 一个。同一次调用里的多次挂起复用这个对象，只改 `label`。对象在挂起期间被回调、调度器或父续体引用，所以它在堆上，局部变量里那些要跨过挂起点的也会变成它的字段。不跨挂起点的局部变量可以只留在某一次进入时的栈上。

返回值的约定要同时记住两种形态。源码里的 `suspend fun load(): String`，变换之后对 JVM 来说大致是「接收 Continuation，返回 `Any?`」。返回真实结果表示没挂起（快路径）。返回哨兵表示已挂起（慢路径）。抛异常表示这次调用同步失败。所以你不能看 Kotlin 签名以为它永远会挂起：缓存命中、`delay` 的非正参数、已经完成的 `Deferred`，都可能在当前栈上直接给出结果。

## 原理

1. **为什么必须是状态机。** 挂起时线程要去跑别的协程，原来的栈帧不能留着。编译器把「挂起点之间的代码」切成状态。进入函数时看 `label`：0 是从头开始，1 是第一个挂起点已经有结果，以此类推。每个挂起点之前先把 `label` 改成下一次要进来的值，再调用下一个 `suspend` 函数。这样如果对方返回哨兵，栈退掉之后，将来恢复仍能跳到调用之后，而不会把同一个请求再发一次。

2. **快路径会穿透，慢路径必须上传哨兵。** 伪代码只表达约定，不是某一版编译器的逐字输出：

```text
fun load(cont: Continuation): Any? {
    val sm = 复用或新建状态机(cont)
    when (sm.label) {
        0 -> {
            sm.label = 1
            val a = fetchA(sm)                  // fetchA 也是变换后的函数
            if (a === COROUTINE_SUSPENDED) return a
            sm.result = a                       // 没挂起，当前栈上继续
        }
        1 -> { /* 从 sm.result 取出 A */ }
        2 -> { /* 从 sm.result 取出 B，计算最终结果 */ }
    }
    return 最终字符串                           // 不是哨兵：本函数结束
}
```

调用方看到哨兵就立刻 return 哨兵，不能碰返回值，也不能在这次栈上执行挂起点后面的逻辑。看到普通值就落下来，和同步调用一样。整个协程只有真的遇到还没完成的等待，线程才会被放开。

3. **`result` 里既有值也有异常。** `resumeWith` 收到的是 `Result`。状态机把它放进 `result`，再按 `label` 进入。每个挂起点恢复后的第一件事是把失败重新抛出：如果上次是 `resumeWithException`，就在这个挂起点抛出来。因此源码里写在 `delay()` 或 `withContext` 外面的 `try/catch` 仍然包得住。异常不是从另一个线程的栈顶凭空冒出来的，它是在恢复后的状态里被重新抛出的。

4. **续体链代替了调用栈。** 每个状态机还有一个 `completion`，指向调用它的那个函数的续体。本函数 return 了一个非哨兵的结果时，基础设施用这个结果去 `resume` 外层。挂起期间 JVM 栈是空的，返回地址在这条对象链上。这就是等待中的协程只占一块小对象、不占默认线程栈的原因。反过来，快路径不挂起时，就是普通的嵌套调用，该多深还是多深，并没有魔法把同步递归变成堆。

5. **拦截发生在 `resume`，不发生在你的业务函数签名上。** `ContinuationInterceptor.interceptContinuation` 把原始续体包成调度器认识的续体，一般是 `DispatchedContinuation`。`intercepted()` 只会包一次并记住结果。之后谁调用 `resume` / `resumeWith`，先进这个外壳。外壳看 `isDispatchNeeded(context)`：需要派发，就把一个任务提交给线程池或主线程 Handler，当前这段回调马上结束；不需要派发，才在当前线程直接进入状态机。协程体里的代码因此默认跑在 Dispatcher 承诺的线程上，而不是跑在「谁把结果准备好了」的那条线程上。

6. **为什么恢复不保证同线程。** 准备好结果的经常是别的线程：定时器、OkHttp 的回调、数据库的完成回调。拦截器的职责就是不要在那条线程上接着跑用户代码，而是 `dispatch` 到上下文里的调度器。`Dispatchers.Default` 和 `IO` 是池，任务下来时哪条工人空闲用哪条。同一次协程，挂起前在 worker-1，挂起后可以在 worker-3。`Dispatchers.Main` 看起来「总是同一条」，是因为主线程只有一条，不是因为续体记住了线程号。`Main.immediate` 多一个判断：当前已经在主线程则 `isDispatchNeeded` 为 false，这段就内联执行，于是 `viewModelScope.launch { ... }` 开头的同步代码可能在 `launch` 返回之前跑完，调用方会被重入。

7. **没有拦截器或 `Unconfined` 时，恢复留在调用 `resume` 的线程上。** `Unconfined` 的第一段在启动者的线程上跑，第一次真挂起之后，谁 `resume` 就留在谁的线程。可能是定时器线程，也可能是某个 SDK 的回调线程，后面不挂起的代码就一直在那，包括碰 View。它不是「不切线程」，是「不替你把线程纠正回来」。业务代码不用它。

8. **`yield` 和 `delay(0)`。** `delay` 的实现里，时间小于等于 0 就直接 return，不进入 `suspendCancellableCoroutine`，因此不挂起，也不检查取消。`delay(0)` 不能用来让出线程，也不能当作取消点。真正要等，至少要正的时间，恢复走调度器的延时队列，到点之后仍可能换工人。`yield()` 相反：入口先 `ensureActive()`，取消了立刻抛；然后通过已经拦截过的续体做一次让出调度，把机会给同一调度器上已经排队的协程。文档说明：若当前调度器上只有自己一个协程，`yield` 可能并不真的挂起，但取消检查仍然会发生；上下文里根本没有 Dispatcher 时，它也不挂起。所以 `yield` 的契约是「协作式让出并检查取消」，不是「至少睡到下一毫秒」，更不能拿来当锁或当 `join`。官方示例把「`yield` 一下等另一个协程先赋值」标成反模式，对方若在赋值前再挂起一次，你的假设就破了。要等就 `join`、`await` 或 `Channel.receive`。

9. **同线程是协作，不是抢占。** 状态机一次只被一个调度任务进入，协程体在两次挂起之间不会并行地跑在两条线程上。但操作系统抢占的是线程：时间片到了，内核可以让出 CPU，回来时仍从你这条协程的下一条字节码继续，同 Dispatcher 上的其他协程不会因此得到机会。主线程上的紧循环会一直占着 Looper。`yield` 把自己重新排队，Looper 才能处理输入和其他协程。在多线程的 Default 上，其他协程可以在别的核上真并行，只是不会把你这个状态机劈成两半。所以共享 `var` 在 `Main` 或 `limitedParallelism(1)` 上靠「挂起点之间不交错」就够；在 Default 上不够，需要 `Mutex` 或并发结构。

10. **普通函数不能调用挂起函数。** 普通函数没有那个隐藏的 `Continuation` 参数，编译器无从把哨兵往上传，也没有状态机可恢复。报错是「Suspend function can only be called from a coroutine or another suspend function」。这不是运行时检查，是类型系统里的颜色：`suspend` 改变了函数的调用边界。`launch` / `async` 的 lambda 本身是挂起类型，所以块里可以调。它们是在非挂起世界里把初始续体造出来的地方。`runBlocking` 是另一条桥：它在当前线程上跑事件循环，真挂起时把这条线程停住，直到协程完成。这会占住工人。在 Android 主线程上 `runBlocking`，协程体内再 `withContext(Main)`，主线程在等协程，协程在等主线程，死锁。库代码不要用 `runBlocking` 假装自己是同步 API，除非文档写明调用方不能持有主线程或同一个单线程调度器。

11. **取消怎样插进续体。** 普通 `suspendCoroutine` 不登记取消。Job 已经取消，这段仍要等回调来 `resume`，等待期间收不到 `CancellationException`。`suspendCancellableCoroutine` 把续体登记到 Job 上：取消发生时，若还没恢复，就用 `CancellationException` 恢复，并跑 `invokeOnCancellation`，让你取消 OkHttp Call 或反注册监听。回调和取消谁先到都不应该恢复两次。`resume` 两次会抛 `IllegalStateException`。要用「只有第一次生效」的语义，并在取消路径里处理那次没送出去的值。恢复之后，状态机在挂起点把取消异常抛出来，`finally` 才有机会走。手写回调桥时这是正确性，不是风格。见 `kp-callback-to-suspend`。

12. **`inline` / `noinline` 点到为止。** `inline suspend` 允许，状态机生成在调用点，少一层续体对象，所以标准库里很多小操作是内联的。一旦 `suspend` lambda 要存起来、在当前调用返回之后才执行，它必须是 `noinline`，否则没有一个可保存的对象。`crossinline` 只禁止非局部 return，不解决逃逸。`coroutineScope`、`withContext` 这种要建立新 Job 或切换拦截器的边界不能为了省分配硬内联掉。实践上的坑是：`runCatching` 是内联的，里面的 `catch` 范围盖住 `CancellationException`。在可取消的协程里用它包一整段挂起，会把取消收成 `Result.failure`，协程继续往下跑。要么不用，要么失败时把取消重新抛出。

## 使用与实践

业务层不要手写状态机，也不要依赖反编译出来的 `label` 数字，编译器怎么编号不是 API。要控制的是挂起点放在哪：循环里有没有 `ensureActive` 或 `yield`，阻塞调用有没有放进会挂起的边界，回调有没有接上取消。

读别人反编译或断点时，用三个问题对齐源码。当前 `label` 对应哪一次挂起之后？`result` 是值还是需要重新抛出的异常？这一帧返回的是哨兵还是最终结果？返回哨兵时，当前线程马上就可以去跑队列里的下一个任务，你的局部变量已经在状态机字段里。

切换线程优先 `withContext`。它会挂起、派发、再把结果恢复到调用方原来的拦截器上。不要在挂起函数里自己 `handler.post` 然后返回一个还没准备好的值，那就把状态机的约定写破了。需要从回调恢复，用 `suspendCancellableCoroutine`，恢复一次，取消时放掉底层资源。

不要用 `delay(0)` 修复「主线程卡、同线程的另一个协程不跑」。它什么都不做。用 `yield()`，并确认这段工作本来就该在这个 Dispatcher 上；大计算应挪到 `Default`，而不是在主线程上疯狂 yield。也不要用 `yield` 轮询某个 `var` 是否被别的协程写上，那是忙等。

`CoroutineStart.UNDISPATCHED` 和 `Main.immediate` 都会让开头一段跑在调用者线程上，直到第一个真正挂起的点。写「这个 lambda 一启动就已经在 IO 上」之前，先看启动模式。默认的 `launch` 会先派发；`viewModelScope` 因为是 immediate，在主线程上调用时开头是同步的。

内联与否不要当性能第一手段。先保证取消边界和线程边界对。只有分配已经证明在热点上，再考虑把不会逃逸的小挂起函数内联。

## 例子

下面用源码能观察到的行为说明三条内部约定，而不是模拟编译器。

```kotlin
fun main() = runBlocking {
    // 1) delay(0) 不挂起：前后线程相同，且不会让出
    launch(Dispatchers.Default) {
        val t = Thread.currentThread()
        delay(0)
        check(Thread.currentThread() === t)
    }.join()

    // 2) 正延迟之后不保证同线程（Default 池）
    launch(Dispatchers.Default) {
        val t = Thread.currentThread()
        delay(1)
        println(Thread.currentThread() === t) // 允许 false
    }.join()

    // 3) 普通函数里不能写 delay()。要等就得先进入协程。
    //    runBlocking 会堵这条线程，Android 主线程上禁止。
}

suspend fun firstOne(): String =
    suspendCancellableCoroutine { cont ->
        val call = enqueue { value, error ->
            when {
                error != null -> cont.resumeWithException(error)
                else -> cont.resume(value)
            }
        }
        cont.invokeOnCancellation { call.cancel() }
    }
```

`firstOne` 里的 `cont` 就是这次挂起的续体。`resume` 之后，状态机从 `firstOne` 的调用点往后走，并且先经过拦截器，所以 `firstOne` 的调用方继续在自己的 Dispatcher 上，不在 `enqueue` 的回调线程上。如果在 `resume` 之前 Job 被取消，`invokeOnCancellation` 取消 `call`，`firstOne` 的调用点抛出 `CancellationException`，不会再拿一个过期的 `value`。

让出和假让出：

```kotlin
viewModelScope.launch {
    while (pending.isNotEmpty()) {
        step(pending.removeFirst())
        yield() // 主线程上给输入和别的协程一次机会，并检查取消
    }
}
```

把 `yield()` 换成 `delay(0)`，循环仍是同步的，掉帧不会好，取消也要等到以后某个真正的挂起点。

```kotlin
// 错：以为 suspend 一定挂起（快路径 counter-example）
suspend fun maybe(): Int {
    val cached = cache.get()
    if (cached != null) return cached // 不经过挂起点，栈上直接返回
    return remote() // 这里才可能 COROUTINE_SUSPENDED
}
```

## 画面

```text
调用 suspend 函数
    |
状态机 label == 0，执行到挂起点
    |
内层返回 COROUTINE_SUSPENDED ？
    |是                          |否（快路径）
    v                            v
把哨兵一路 return             把结果放进 result，label 已指向下一步
JVM 栈退出                    仍在当前栈上进入下一个状态
线程去干别的
    |
回调线程调用 continuation.resumeWith(result)
    |
DispatchedContinuation
    isDispatchNeeded ?
    |是                         |否（immediate / 已在目标线程）
    v                           v
dispatcher.dispatch            直接进状态机
池或 Main 的某条线程
    |
再次进入状态机，把失败结果重新抛出，从 label 继续
    |
函数最终返回非哨兵 --> resume 外层 completion
```

## 常见坑与追问

1. **「协程切换就是保存内核栈。」** 追问挂起时局部变量在哪。在状态机字段里。栈已经退了。不跨挂起点的变量不必进对象。
2. **「`suspend` 调用一定会挂起。」** 追问哨兵以外的返回。快路径直接给值，当前线程不会让出。`delay(0)` 就是这种实现。
3. **「恢复还在回调线程，所以我在 `resume` 后面更新了 UI。」** 追问拦截器。你 `resume` 的是已拦截的续体时，更新 UI 的代码要写在挂起点之后，让它在 `Main` 上跑；写在回调线程里、`resume` 之外的代码，仍在回调线程。
4. **「`yield` 一下，另一个协程肯定先跑完。」** 这是文档里的反模式。`yield` 只保证让出一次机会，不保证对方不再挂起。等完成用 `join`。
5. **「`delay(0)` 至少会把任务排到队尾。」** 源码对非正延迟直接 return。队尾让出是 `yield` 的事，而且只有一个协程时 `yield` 也可能不挂起，但会 `ensureActive`。
6. **「为了不卡主线程，在主线程循环里 `yield`。」** 工作若是 CPU 重活，`yield` 只是把卡顿摊开，帧仍然被计算占着。搬到 `Default`。`yield` 适合的是本来就该留在这个线程、但需要穿插其他任务的进度更新。
7. **「`runBlocking` 写在仓库层，调用方看起来是同步函数，很方便。」** 追问谁拿着主线程或单线程调度器来调它。方便的是 API 形状，死锁的是线程。挂起颜色要传到边界，而不是在中间堵上。
8. **「`inline` 了就没有 Continuation。」** 内联是把状态机嵌进调用方，挂起约定还在。lambda 一旦逃逸就必须 `noinline`，那时对象回来了。`runCatching` 这种内联 catch 还会把取消吞掉。
9. **手写续体 `resume` 两次。** 成功回调和失败回调都可能到，取消也可能插进来。只允许一个胜出，取消时把底层请求停掉，避免恢复一个已经离开页面的协程。
