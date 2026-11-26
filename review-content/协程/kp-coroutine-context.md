---
id: kp-coroutine-context
type: knowledge
module: coroutine
title: CoroutineContext 元素与异常处理器
priority: P0
version: 3
order: 30
requires: [kp-coroutine-basics]
---

## 一句话

`CoroutineContext` 是按 Key 索引的一组元素：`+` 合并，同 Key 右边覆盖左边；子协程继承这组元素，但会换上自己的 `Job`。`CoroutineExceptionHandler` 只处理没人接住、并且已经传到根（或监督者拒绝接手）的异常，协程当时已经结束，它不是 `try/catch`。

## 组成与结构

标准库里面试要能点名的元素：

| 元素 | Key | 决定什么 | 不决定什么 |
|------|-----|----------|------------|
| `Job` | `Job` 的伴生对象 | 父子关系、取消、生命周期 | 在哪条线程跑 |
| `CoroutineDispatcher` | `ContinuationInterceptor` | 续体在哪类线程上恢复 | 异常算不算被接住 |
| `CoroutineName` | `CoroutineName` | 调试时线程名里的名字 | 调度和异常路由 |
| `CoroutineExceptionHandler` | 它自己的 Key | 未捕获异常的最后上报 | 恢复协程、接住取消 |

`CoroutineDispatcher` 继承 `ContinuationInterceptor`，两者共用一个 Key。一个上下文里最多一个调度器。你再 `+` 一个自定义拦截器，会把 Dispatcher 整个换掉，不是并列。

还有一类专家加分元素：`ThreadContextElement`（常见写法是 `ThreadLocal.asContextElement(value)`）。它不改变去哪条线程，而是在每次恢复前把值写进当前线程、跑完这段再恢复现场，避免池线程把 `ThreadLocal` 漏给下一个协程。

上下文是不可变的。`plus` 返回新结构，不改左边那个。`EmptyCoroutineContext` 是加法的单位元：任何上下文加它还是自己。

子协程实际拿到的上下文可以记成这三步，顺序不要换：

1. `父 coroutineContext + 这次 launch/async 传入的 context`。同 Key 以传入的为准。
2. 合并结果里如果没有 `ContinuationInterceptor`，补上 `Dispatchers.Default`。调试探针打开时还可能再加一个 `CoroutineId`。
3. 构建器新建一个子 `Job`，父指针指向第 1 步里的那个 `Job`，再用这个子 Job 覆盖上下文里的 Job 元素。

所以协程体内 `coroutineContext[Job]` 永远是自己。父亲要靠 `job.parent` 才看得到。`withContext(dispatcher)` 也是一次新的子协程：拦截器换成目标 Dispatcher，Job 仍是当前 Job 的孩子，取消传得进去；它是挂起函数，异常在 `withContext` 那一行抛回调用方。

`CoroutineScope` 只是「持有一个上下文」的门面，用在非挂起的边界上 `launch`。挂起函数里没有 `this: CoroutineScope` 时，用的是 `kotlin.coroutines.coroutineContext`，也就是当前续体上的那份。两份在 `launch` 的 lambda 里是同一套元素，但类型不同，不要混着说「scope 就是 context」。

## 原理

1. **Key 为什么是身份，不是名字。** `get`、`minusKey`、`plus` 都用 Key 的相等性找元素。标准元素的 Key 是伴生对象，进程里只有一份。自定义元素要自己声明唯一的 `CoroutineContext.Key`。两个类型若误用同一个 Key，后写的会把前一个挤掉，读出来的类型也会错。框架不按类名扫描上下文。

2. **`plus` 的折叠。** 实现上是用右边的 `fold` 把每个元素贴到左边：先按这个元素的 Key `minusKey` 掉旧的，再放进新的 `CombinedContext`。因此同 Key 一定是右边胜，而且结构里不会留下两份同 Key。`fold(initial) { acc, element -> ... }` 是唯一公开的遍历方式，先走到左边已有的元素，再碰到更晚加上去的。不要依赖遍历顺序做业务判断，合并规则只保证「同 Key 取最后一次加的」。

3. **`get` 找不到就返回 null，不会造默认值。** `coroutineContext[CoroutineName]` 可能是 null。`coroutineContext[ContinuationInterceptor]` 在真正跑起来的协程里通常有值，因为第 2 步补过 Default；你在自己 `fold` 一个半成品上下文时不要假设 Dispatcher 已经在。

4. **继承与覆盖是两套 Key 策略。** `CoroutineName`、`CoroutineExceptionHandler`、`ThreadContextElement` 这类不冲突的元素会留在子协程里，除非子协程的参数用同 Key 再盖一次。`Job` 特殊：子协程总是安装新 Job，你传入的 `Job()` 或 `SupervisorJob()` 变成这个新 Job 的父亲，而不是「子协程自己的 Job 对象」。传入 `Dispatchers.Main` 只覆盖拦截器，父亲还是 Scope 原来的 Job，取消关系还在。传入 `Job()` 则把父亲换成这个没挂在 Scope 上的 Job，Scope 取消不会传到这里。`launch(Job())` 是结构化并发的出口，和 `GlobalScope` 一样要能指出来。

5. **`SupervisorJob()` 当参数，和 `supervisorScope` 不是同一个位置。** `supervisorScope { }` 自己仍是当前协程的子 Job，外部取消进得来；它只是对自己的孩子做监督：孩子失败不取消它，也不取消其他孩子。`launch(SupervisorJob())` 是换父亲，当前 Scope 取消不到这张新工单。面试里这两个经常被说成一句「用 Supervisor 就隔离了」，要拆开。

6. **异常处理器看的是「还有没有人接」，不是「上下文里有没有这个元素」。** 元素可以被继承下去，但子协程失败时，框架先问父亲。普通 `Job.childCancelled` 会接手：父进入失败并取消其他孩子。异常算被父处理了，子上下文里的 `CoroutineExceptionHandler` 不调用。`SupervisorJob.childCancelled` 返回 false，表示不接手。这时异常才算未捕获，框架用这个协程上下文里的 handler；没有就走平台默认的未捕获处理。

7. **CEH 的三条同时成立。** 第一，异常不是 `CancellationException`。取消是协作式结束，所有 handler 故意忽略它，包括 `TimeoutCancellationException`，因为它是取消的子类。第二，没有更具体的接手者：协程体内部的 `try/catch` 没有接住，也没有通过 `coroutineScope` / `withContext` 这种会重新抛出的挂起函数交给调用方，async 也没有把异常留在 `Deferred` 里算作用户的责任。第三，父链上没有普通 Job 接手，也就是这是根协程，或者父是监督者。三条缺一，handler 就是死的。调用发生时协程已经以该异常完成，里面不能再 `resume`，不能当成立即重试的现场。

8. **和 `try/catch` 的时机差在哪。** `try/catch` 接的是某一次挂起调用或某段同步代码抛出来的异常，接住后协程还可以继续，父 Job 不会失败。它必须写在会抛的那个协程体里面，或者包住会把异常抛回来的挂起函数。包住 `launch { }` 或 `async { }` 的那一行没有用，那一行只是把子协程交出去，立刻返回 `Job` 或 `Deferred`。`runBlocking` 更特殊：子协程的异常会重新抛到被堵住的那条线程上，用来让 `main` 失败，不是让你在 handler 里弹 Toast。

9. **`launch` 和 `async` 的交付不同，父是否失败却往往相同。** `launch` 没有地方取异常，未捕获就只能上报。`async` 把异常放进 `Deferred`，`await` 时在调用方那一行抛出，所以 async 自带的 `CoroutineExceptionHandler` 没有效果，官方示例里根上的 `GlobalScope.async(handler)` 不会打印。不 `await` 也不等于改走 CEH，异常就留在 Deferred 里。但是只要父是普通 Job，这个 async 一失败就会取消父和兄弟，不必等到有人 `await`。想并行、想自己 `catch`、还不想拆掉兄弟，用 `supervisorScope` 包住这些 `async`，再在作用域里 `await`。

10. **`coroutineScope` 把异常交回调用方，所以不进 CEH。** 它是普通子 Job。任一孩子抛出非取消异常，作用域失败，其他孩子被取消，然后异常从 `coroutineScope(...)` 这行抛出。外层 `try/catch` 接住，就属于「有人接了」。这也是结构化并发推荐的失败出口：让挂起函数的调用者处理，而不是在某个看不见的根上挂 handler。`supervisorScope` 正相反：孩子的 `launch` 失败不从作用域抛出，作用域照常返回。异常若没在孩子内部接住，就按未捕获处理。监督作用域不会把失败变成返回值。

11. **多个孩子一起失败时，第一个非取消异常是主异常。** 其余挂在 `suppressed` 上（JVM）。取消异常在这套聚合里是透明的：你在 `join` 的 `catch` 里把 `CancellationException` 原样抛出，根上的 handler 拿到的仍是最初那个业务异常，而不是这层包装。讲「异常被取消覆盖了」之前，先看 suppressed 和这条例外。

12. **Android Scope 为什么特别。** `viewModelScope` 和 `lifecycleScope` 的上下文是 `SupervisorJob() + Dispatchers.Main.immediate`。子 `launch` 的失败不会取消旁边的子协程，这是界面上两块数据互不影响的原因。也正因为父不接手，这个子 `launch` 若既不内部 `catch`，Scope 上又没有 CEH，异常就是未捕获。调试包里常见的结果是崩溃，而不是安静地停掉一个请求。CEH 要起作用，得装在这个子协程的上下文里（参数里传入，或做在 Scope 上让它继承）。装了也只适合记日志和上报，界面错误态仍然应该在协程体里写成 `Result` 或 `UiState`。

13. **`Main.immediate` 和上下文的关系。** 它是拦截器，不是 Job。当前线程已经是主线程时，`isDispatchNeeded` 为 false，协程体开头会在 `launch` 返回之前直接跑。这是重入的来源：`launch` 里同步修改的状态，调用方下一行就能看见。已经在后台线程时，`Main` 和 `Main.immediate` 都会把恢复派回主线程。换 Dispatcher 不要顺手换掉 Job。

14. **ThreadLocal 为什么要进上下文。** 池线程是复用的。你在协程里 `threadLocal.set`，一挂起，恢复可能在另一条工人上，值没了；原来那条工人还会把值带给下一个协程。`asContextElement` 把值放进上下文，每次调度切片前写入、切片后恢复。这是专家加分。它仍然不是锁：两个并行协程可以各持一份元素，在不同线程上同时跑。需要复制到子协程的实现会走 `CopyableThreadContextElement`，避免父子共用一个可变盒子。

15. **`await` 上 catch 住，不等于父没失败。** 普通 `coroutineScope` 里，`async` 一抛出非取消异常，作用域马上开始取消其他孩子，不必等你执行到 `await`。你后来在 `await` 上把这一个异常 catch 住，只说明调用点不再往外抛；兄弟收到的取消收不回来。想让兄弟继续，监督要在失败发生前就位。catch 改变的是「这个异常还会不会沿你的栈往上走」，改变不了「普通父已经接手并取消了别人」。

16. **继承到的 CEH，只在这个协程自己就是上报点时才用。** handler 加在 `CoroutineScope` 上，子 `launch` 会把这个元素继承下来。父是 `SupervisorJob` 时，子失败会去查子上下文，能找到这份 handler。父是普通 Job 时，子把异常交给父，根本不查 handler，继承了也等于没装。因此「Scope 上装了 handler，所有子异常都能打日志」只对监督父或根上的 `launch` 成立。中间那层 `coroutineScope` 会把异常变成自己的失败：要么被外层 `try/catch` 接住，要么由更外面的上报点处理。子参数里写的 handler 仍然不运行。

## 使用与实践

业务 Scope 自己组装时写清楚三样东西：谁是父 Job（一般是 `SupervisorJob()` 配页面或进程的 `close()`）、默认 Dispatcher（界面用 `Main.immediate`）、要不要一个只做日志的 CEH。CEH 不要弹界面，不要清状态，协程已经死了。

```kotlin
val appScope = CoroutineScope(
    SupervisorJob() +
        Dispatchers.Main.immediate +
        CoroutineName("app") +
        CoroutineExceptionHandler { ctx, e ->
            log("uncaught in ${ctx[CoroutineName]}", e)
        }
)
```

页面级工作优先用现成的 `viewModelScope`，不要再套一层没人 `cancel` 的 Scope。需要和页面生命周期不一致的工作，用有文档写明 `close()` 的那一个，并在里面 `supervisor` 的 Job 上 `cancel()`。

失败优先写成返回值。网络和解析的挂起函数抛异常也可以，但调用方要用 `coroutineScope` 或函数自己的 `try/catch` 接住，转成错误态。不要把「全局 handler 里更新 LiveData」当架构。

并行请求：

```kotlin
suspend fun load(): Screen = coroutineScope {
    val a = async { repo.a() }
    val b = async { repo.b() }
    Screen(a.await(), b.await())
}
```

这里任一失败会取消另一个，异常从 `load()` 抛出。若产品要求一边失败另一边仍展示，改成 `supervisorScope`，且每个 `async` 内部把异常收成 `Result`，或者 `await` 时各自 `catch`。只改用 `supervisorScope` 却不 `await`、不 `catch`，失败会变成未捕获。

临时换线程用 `withContext`，不要 `launch(Dispatchers.IO)` 再去等一个外部的 `CompletableDeferred`，除非你真的需要和当前协程并行。`withContext` 会把 Job 关系留在父上，取消进得去。

读上下文做日志可以，用上下文做业务分支要克制。`CoroutineName` 可以打进日志。不要用「有没有某个 Job」判断自己是不是在主线程，线程只看拦截器，或者直接看已经约定好的 Dispatcher。

自定义元素只适合跨层传递调用链 id 这类不可变数据。不要把数据库连接、View、可变集合塞进上下文绕过参数，生命周期和取消都对不上。

## 例子

同 Key 覆盖，Job 被换成脱离 Scope 的父亲：

```kotlin
val parent = SupervisorJob()
val base = parent + Dispatchers.Main.immediate + CoroutineName("vm")

val detached = base + Job() + Dispatchers.IO + CoroutineName("orphan")
// detached[ContinuationInterceptor] 是 IO
// detached[CoroutineName] 是 orphan
// detached[Job] 是那个新 Job，parent 不再是它的父亲

val stillChild = base + Dispatchers.IO
// Job 仍是 parent，只是线程池换成 IO
```

CEH 装错位置：

```kotlin
val handler = CoroutineExceptionHandler { _, e -> log(e) }

viewModelScope.launch {
    // 父是 SupervisorJob：这个 launch 的失败不会取消其他子协程
    launch(handler) {
        throw IllegalStateException("child")
        // 父不接手 -> handler 会收到
    }
    coroutineScope {
        launch(handler) {
            throw IllegalStateException("nested")
            // 父是普通 coroutineScope，父接手并向外抛
            // 这个 handler 不会被调用
        }
    }
}
```

外层 `coroutineScope` 抛出来的异常若再没人接，才会变成 `viewModelScope` 那个 `launch` 的未捕获。因为 `viewModelScope` 是监督者，这个外层 `launch` 自己的上下文里如果有 handler（从 Scope 继承或参数传入）才会响。`viewModelScope` 默认没有 CEH。

`async` 与 handler：

```kotlin
supervisorScope {
    val one = async { fetch(1) } // 失败只留在 Deferred
    val two = async { fetch(2) } // 不会被 one 取消
    val a = runCatching { one.await() }
    val b = runCatching { two.await() }
    render(a, b)
}
```

`runCatching` 会连 `CancellationException` 一起收进 `Result`。这里如果是用户离开页面导致的取消，应该把取消重新抛出，只把业务异常收成失败。监督解决的是「兄弟不要互相拆」，不是「取消也可以吞」。

调试名只有在协程调试打开时才会出现在线程名里，形如 `DefaultDispatcher-worker-1 @orphan#3`。没开探针时，`CoroutineName` 仍然能从上下文读到，只是不会自动改线程名。不要用线程名是否包含某字符串来做逻辑。

## 画面

```text
launch(context) 时的上下文

父上下文 ----+----> 合并（同 Key 右边胜）
传入 context -+
                 |
                 +-- 没有拦截器？补 Dispatchers.Default
                 |
                 +-- 新建子 Job，parent = 合并结果里的 Job
                        协程体内 coroutineContext[Job] = 子 Job

子协程抛出非 CancellationException
                 |
     父是普通 Job？ --是--> 父失败，取消兄弟，异常不算未捕获
                 |              |
                 否             +--> 若父是 coroutineScope / withContext
                 |                   再抛给调用方的 try/catch
                 v
     父是 Supervisor 或已经是根
                 |
     launch：上下文里的 CEH（没有则平台默认，Android 上常崩溃）
     async ：异常在 Deferred 里，CEH 不生效，等 await
     CancellationException：谁都不当失败，CEH 不看
```

## 常见坑与追问

1. **「我在每个 launch 上都加了 CEH，为什么只有一部分会打印？」** 追问父是谁。普通 `coroutineScope` 的孩子把异常交给父，子的 handler 被跳过。`viewModelScope` 直接 `launch` 的孩子，父是 `SupervisorJob`，handler 才有机会。
2. **「try/catch 包住 launch 了。」** 追问 catch 相对挂起发生的时间。`launch` 返回时协程体还没抛。catch 要写进块里，或包住 `coroutineScope` / `withContext` / `await`。
3. **「async 的异常会进 CEH。」** 官方行为相反：async 把异常表示在 `Deferred` 里，handler 没有效果。追问：不 await 呢？仍不改走 CEH，只是没人取。追问：兄弟停了吗？普通父会停，监督父不会。
4. **「SupervisorJob 和 supervisorScope 我都用了，所以页面销毁也会留下这个协程。」** 前者当 `launch` 的参数时会换父，后者不会。页面销毁要停的工作不能换父。
5. **「handler 里再开一个协程去重试。」** 原来的 Job 已经完成且失败，重试是一次新的业务启动，要有自己的 Scope 和退避，不能假设旧上下文还能接着跑。
6. **「上下文里加了 CoroutineName，线程就固定了。」** 名字不参与调度。线程只看拦截器。同一次协程两次挂起，`IO` 上可以是两个 worker。
7. **「fold 的顺序就是 plus 的优先级。」** 优先级规则只有同 Key 覆盖。`fold` 用来观察有哪些元素，不要靠遍历顺序决定谁生效。
8. **把 `TimeoutCancellationException` 漏出 `launch`。** 它是取消的子类，CEH 不当成业务错误。超时要在 `withTimeout` 外单独 catch，写成错误态。用户离开页面的普通取消不要和超时合成同一种 Toast。
