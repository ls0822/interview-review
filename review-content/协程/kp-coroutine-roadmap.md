---
id: kp-coroutine-roadmap
type: knowledge
module: coroutine
title: 协程掌握地图与复习顺序（专家）
priority: P0
version: 3
order: 1
---

## 一句话

协程面试不是背 API 表：先能讲清「挂起让出线程、恢复靠调度器」，再沿结构化并发把取消和异常走到根上，最后才用 Flow 和 Android 生命周期把数据接到界面。

下面用两档标注。**P0 必会**是资深岗位开口就得讲对的边界。**专家加分**是追问 why 时拉开差距的机制，不是日常写业务的第一反应，但资深场会被点名。

## 组成与结构

按层记，不要按字母表记。每一层只回答一个问题，下一层默认你已经能答上一层。

| 层 | 要回答的问题 | 主篇 | 档 |
|----|----------------|------|----|
| 模型 | 协程和线程谁在干活，挂起时栈去哪了 | `kp-coroutine-basics` | P0 必会 |
| 调度 | 恢复发生在哪条线程，池子怎么被占满 | `kp-coroutine-dispatchers` | P0 必会 |
| 上下文 | 子协程继承什么、谁覆盖谁、异常处理器装在哪才有用 | `kp-coroutine-context` | P0 必会 |
| 结构化 | `launch` / `async` / `withContext` / Scope 谁在等谁 | `kp-coroutine-builders` | P0 必会 |
| 取消与异常 | 取消为什么停不干净，失败为什么会拆掉兄弟 | `kp-coroutine-cancel` | P0 必会 |
| 桥接回调 | 一次性回调怎么变成可取消的挂起 | `kp-callback-to-suspend` | P0 必会 |
| Channel / Mutex | 协程之间怎么交接数据、怎么保护可变状态 | `kp-coroutine-channel-mutex` | P0 必会 |
| Flow | 冷热、重放、当前值 | `kp-coroutine-flow` | P0 必会 |
| Android 收集 | 背压、`stateIn`、页面停了谁还在跑 | `kp-flow-backpressure-android` | P0 必会 |
| 挂起实现 | 状态机、CPS、续体怎么被 Dispatcher 拦截 | `kp-coroutine-internals` | 专家加分 |

P0 必会，开口要能落到例子上：

- 模型：`delay` 让出线程，`Thread.sleep` 占住工人；恢复不保证还是原来那条线程，`Main` 例外是因为主线程只有一条。
- 调度：`viewModelScope` 是 `SupervisorJob + Main.immediate`，裸 `launch` 在主线程。阻塞放 `Dispatchers.IO`，CPU 放 `Default`。`limitedParallelism(n)` 限的是同时跑的协程数，不新建 n 条操作系统线程。
- 结构化：`launch` 不把结果交回下一行；`async` 要 `await`；`withContext` 是同一张工单换线程，块结束才继续。Scope 取消，子 Job 一起收到取消。
- 取消：`cancel()` 只改状态，下一个协作点才抛 `CancellationException`。`catch (Exception)` 会把取消吃掉。`NonCancellable` 只包清理那几行。
- 异常：普通父 Job 下，一个孩子的非取消异常会取消兄弟。`CancellationException` 不把父标成业务失败。
- 桥接：一次性回调用 `suspendCancellableCoroutine`，在 `invokeOnCancellation` 里取消底层请求。多次回调用 `callbackFlow`。
- 同步：`Mutex` 不可重入，`withLock` 里面挂起不会放锁。`Channel` 容量 0 是会合。
- Flow：冷流每次 `collect` 重跑上游；`StateFlow` 必有初值，`equals` 相同不再通知。
- Android：界面收集用 `repeatOnLifecycle(STARTED)` 或 `collectAsStateWithLifecycle`。一次性事件不要塞进 `StateFlow`。

专家加分，被追问再展开，但每条都要有一句为什么：

- `suspend` 编译成带 `Continuation` 的状态机；返回 `COROUTINE_SUSPENDED` 表示这次真的挂起，调用方必须立刻把这个标记往上传。
- `CoroutineContext` 按 Key 合并，同 Key 右边覆盖左边。`Job` 和 `ContinuationInterceptor`（Dispatcher 走这个 Key）都不能并存两份。
- 子协程上的 `CoroutineExceptionHandler`，只要异常还会交给父，就永远不会被调用。
- `yield()` 是让出并检查取消；`delay(0)` 在实现里直接 return，不挂起。
- `flowOn` 只改它上面的上游；`buffer` / `conflate` / `collectLatest` 是三种不同的背压，不是同一件事的别名。
- `SharingStarted.WhileSubscribed(5_000)` 是为了旋转时不断上游，离开界面几秒后停掉上游。
- 同线程上的协程切换只发生在挂起点。操作系统会抢占线程，不会替你在两个协程之间抢占。

## 原理

这一节是深层原理必掌握清单。复习时每条都要能脱离文章，用自己的例子讲完。

### 1. 状态机与 CPS（专家加分，资深场当 P0 追问）

直接风格是「做完这行再做下一行」，下一行留在调用栈上。CPS（延续传递）把「下一行」变成显式参数：函数多接一个 `Continuation`，做完就调用它，而不是 return 到原来的栈帧。

挂起不能真的把内核栈冻住，所以编译器把一个 `suspend` 函数拆成状态机。每个挂起点是一个状态。真挂起时把还要活过这次挂起的局部变量放进续体对象，函数返回一个哨兵，JVM 栈退干净，线程去干别的。恢复时带着结果再进同一个状态机，从上次的标签往后跑。

为什么要掌握：否则你会把协程说成「轻量线程」，一追问「挂起时局部变量在哪、为什么不会占着 1MB 栈」就断。细节见 `kp-coroutine-internals`。

### 2. Continuation（专家加分）

`Continuation` 只有上下文和 `resumeWith(Result)`。成功和失败都走这一个入口，所以 `try/catch` 写在挂起调用周围仍然接得住：恢复时先把失败抛出来，再执行你写在后面的代码。

续体是一条链。内层函数挂起，把哨兵返回给外层；外层也返回哨兵。整条链的「返回地址」在对象里，不在线程栈上。这就是十万个挂起中的协程不需要十万个线程栈的原因。

Dispatcher 不改这条链的业务含义，它拦截的是「什么时候、在哪条线程上调用 `resumeWith`」。见下一篇和 `kp-coroutine-internals`。

### 3. CoroutineContext 的元素（P0 必会，合并规则是专家加分）

上下文是一组按 Key 索引的元素，不是一个大配置对象。面试四件套：`Job`、`CoroutineDispatcher`（Key 实际是 `ContinuationInterceptor`）、`CoroutineName`、`CoroutineExceptionHandler`。`+` 合并，同 Key 右边覆盖左边。

子协程的公式可以记成：父上下文加上这次传入的上下文，没有拦截器就补 `Dispatchers.Default`，然后新建一个子 Job 换掉上下文里的 Job。所以协程体内的 `coroutineContext[Job]` 是自己，不是父亲。父亲留在子 Job 的 parent 指针上。

`launch(Job())` 会把父 Job 换成一个没人取消的新 Job，结构化并发从这里断开。这是原理题，不是风格题。见 `kp-coroutine-context`。

### 4. 取消的协作点（P0 必会）

取消是把 Job 标成取消中，不是对线程发 `interrupt`。协作点在标准挂起函数的入口和恢复：`delay`、`withContext`、`suspendCancellableCoroutine`、`yield`、`ensureActive`。纯计算循环没有这些调用，标记了也停不下来。

`CancellationException` 用来展开 `finally`，框架不把它当失败。吃掉它，协程就不再是取消状态，父级会以为取消已经完成。阻塞 IO 不看这个标记，取消会停在阻塞返回之后。见 `kp-coroutine-cancel`。

### 5. 异常传播路径（P0 必会，监督和 CEH 的交叉是专家加分）

三条规则一起用，缺一条就会讲反：

1. 非取消异常默认向上失败：子失败，普通父失败，兄弟被取消。
2. `launch` 没有返回值可接异常，一路传到根才算未捕获。`async` 把异常放进 `Deferred`，`await` 才抛给调用方，而且 async 自己的异常处理器不生效；但普通父 Job 仍会因为这个孩子立刻取消。
3. `SupervisorJob` / `supervisorScope` 拒绝接手孩子的失败。失败不取消兄弟。`launch` 的异常因此变成未捕获，子上下文里的 `CoroutineExceptionHandler` 这才用得上。没装，就走平台默认处理，Android 上常常是崩溃。

`coroutineScope` 会把子异常重新抛给调用方，`try/catch` 接住就不进 CEH。`try/catch` 包住 `launch` 调用本身接不住，因为 `launch` 当时已经返回了。

`viewModelScope` 的父是 `SupervisorJob`。一个子 `launch` 失败不会拆掉旁边的子协程，也不会自动变成界面错误态。见 `kp-coroutine-cancel` 的专家补充和 `kp-coroutine-context`。

### 6. 冷热流与背压（P0 必会，三种背压的差别是专家加分）

冷流是配方：没人 `collect` 就不生产，每人收集各跑一遍上游。热流是已经在进行的事实：`StateFlow` / `SharedFlow` 的数据不依附于某一次收集。`stateIn` / `shareIn` 用一个 Scope 把配方跑成热流，所以上游的生命周期跟这个 Scope，不跟某个界面。

默认的冷流是会合：`emit` 会等收集者处理完这个值。这就是最原初的背压。处理不过来时有三条路，不要混：

- `buffer`：上游可以领先若干个值，缓冲满了默认再挂起发送方。
- `conflate`：只留最新，发送方不等，中间值丢掉。
- `collectLatest`：新值到来就取消上一值的处理块。处理块本身必须能在挂起点响应取消，否则「最新」只是标记，旧工作还在算。

见 `kp-coroutine-flow` 和 `kp-flow-backpressure-android`。

### 7. Dispatcher 的线程池与 limitedParallelism（P0 必会）

`Main` 是 Android 主线程，经 Handler 排队。`Main.immediate` 发现当前已经在主线程就直接跑，`viewModelScope` 用的是它，所以 `launch` 开头的代码可能在 `launch` 返回之前就执行，存在重入。

JVM 上 `Default` 和 `IO` 共用 `CoroutineScheduler`。Default 的并行度大约是核数，给不挂起的计算。IO 允许为阻塞任务把并行度抬高（默认至少 64 这一档，可用 `kotlinx.coroutines.io.parallelism` 调）。在 Default 里 `Thread.sleep` 或阻塞 JDBC，会把计算工人睡死。在 IO 里跑大计算，会占住为阻塞准备的配额。

`limitedParallelism(n)` 是调度器上的视图：同时最多 n 个任务在跑，线程仍来自底层池，挂起时线程会还给池子。它保证的是互斥或限流，不保证始终同一条线程。`limitedParallelism(1)` 适合把可变状态收进串行执行。要线程身份（`ThreadLocal` 一直在）得用真正的单线程调度器，并且记得 `close()`。两个各自 `limitedParallelism(1)` 的视图互不排队，可以并行。见 `kp-coroutine-dispatchers`。

### 8. 同线程上的协作调度（P0 必会，和抢占的对比是专家加分）

一条线程同一时刻只跑一个协程的一段，直到这段遇到挂起点。没有挂起点，同 Dispatcher 上排在后面的协程就不会开始，主线程上就是掉帧。`yield()` 把续体重新派发，让已经排队的工作先跑，并且入口就 `ensureActive()`。

这和操作系统抢占不是一回事。时间片到了，内核可以换进程，但这条线程回来时仍从原来的字节码继续，不会自动切到另一个协程。多核上的真并行只发生在不同协程、不同工人之间。单个协程的状态机不会同时在两条线程上跑；挂起之后恢复到哪条工人，由 Dispatcher 决定。

因此「协程里的同步代码天然原子」只在单线程 Dispatcher（`Main`、`limitedParallelism(1)`）上对别的协程成立。在 `Default` 上，另一个协程可以真并行地改同一个 `var`。协程切换不加锁，也不建立 happens-before 以外的内存魔法。共享可变状态用 `Mutex`、单线程视图，或干脆收进 `StateFlow`。见 `kp-coroutine-basics` 和 `kp-coroutine-internals`。

## 使用与实践

推荐复习顺序。每一步先自己讲，再翻对应篇里卡住的那几段。括号里是口述任务，限时两到三分钟，讲不出 why 就算这步没过。

1. **模型。** 读 `kp-coroutine-basics`。口述：一百个网络等待为什么不需要一百个线程；`withContext(IO)` 之后下一行在哪；紧循环为什么饿死同线程的邻居。
2. **挂起实现（专家加分，放在词汇齐了之后马上补）。** 读 `kp-coroutine-internals`。口述：`label`、`result`、`COROUTINE_SUSPENDED` 各干什么；为什么普通函数不能调 `suspend`；`yield()` 和 `delay(0)` 差在哪；恢复为什么可以换线程。
3. **调度。** 读 `kp-coroutine-dispatchers`。口述：`viewModelScope` 的默认线程；IO 和 Default 为什么不能互换；`limitedParallelism(1)` 和单线程池差在哪；`Main` 和 `Main.immediate` 谁会重入。
4. **上下文。** 读 `kp-coroutine-context`。口述：四种元素的 Key；`+` 谁覆盖谁；子协程如何换掉 Job；CEH 的三个同时成立的条件；为什么 `launch(Job())` 会泄漏。
5. **结构化启动。** 读 `kp-coroutine-builders`。口述：`launch`、`async`、`withContext` 谁和当前行并行；`coroutineScope` 结束时在等什么；`GlobalScope` 逃出了哪条父子关系。
6. **取消与异常路径。** 读 `kp-coroutine-cancel`（含文末专家补充）。口述：协作点有哪些；`catch (Exception)` 的后果；`coroutineScope` 和 `supervisorScope` 对兄弟的差别；CEH 在 `viewModelScope.launch` 里什么时候响；超时异常为什么不能漏给 `launch`。
7. **回调桥。** 读 `kp-callback-to-suspend`。口述：为什么不用 `suspendCoroutine`；取消和回调同时完成时谁赢；`CompletableDeferred` 什么时候比续体合适。
8. **Channel 与 Mutex。** 读 `kp-coroutine-channel-mutex`。口述：容量 0、缓冲、`CONFLATED`；`Mutex` 不可重入；锁里 `delay` 为什么不放锁；`Semaphore` 限的是协程不是线程。
9. **冷热流。** 读 `kp-coroutine-flow`。口述：两次 `collect` 会不会打两次网络；`StateFlow` 的三条硬规定；`replay` 和 `extraBufferCapacity` 分别给谁。
10. **背压和 Android 收集。** 读 `kp-flow-backpressure-android`。口述：`buffer` / `conflate` / `collectLatest` 各牺牲什么；`flatMapConcat` / `Merge` / `Latest` 怎么选；`flowOn` 改不改收集者；`WhileSubscribed(5_000)` 在旋转和退后台时各发生什么；为什么 `StateFlow` 不适合 Toast；什么时候改用 `Channel`。
11. **串起来复述。** 回到本篇的画面。用一个「搜索框 + 列表 + 错误 Toast」的例子，从 `viewModelScope` 讲到 `flatMapLatest`，再讲到 `repeatOnLifecycle`，最后补一句取消和异常各自走哪条路。限时八分钟。讲的时候主动标出哪句是 P0、哪句是专家加分，面试官追问再下钻，不要第一分钟就背字节码。

每一遍都用同一套追问当验收，答不上就只重读对应的那一小节，不要从头漫读：

- 取消之后代码还在跑，缺了哪个协作点？
- 异常出现了，父取消了没有，CEH 为什么响或为什么不响？
- 这段代码现在在哪条线程，挂起恢复后还在不在？
- 这个值会被重放、被合并，还是只交给一个消费者？

## 例子

下面这段是第 11 步的口述骨架，数字是面试里要守住的结论，不是实现细节。

```text
搜索：query 是 StateFlow。
  debounce + distinctUntilChanged + flatMapLatest { 挂起的搜索 }
  flatMapLatest：新关键字取消上一次请求（请求必须真的可取消）
  flowOn(IO) 只包住搜索上游
  catch 把失败变成 UiState.Error，放在 stateIn 之前
  stateIn(viewModelScope, WhileSubscribed(5_000), Loading)

界面：repeatOnLifecycle(STARTED) 里 collect。
  STOPPED 时收集协程被取消，订阅数归零。
  5 秒内回来（旋转）上游不重启；停更久上游取消，StateFlow 仍留着最后一次界面状态。

Toast：另开 SharedFlow(replay = 0, extraBufferCapacity = 1)。
  不用 StateFlow，避免旋转把旧 Toast 再放一次，也避免相同文案被 equals 吞掉。

失败隔离：viewModelScope 已经是 SupervisorJob。
  搜索协程自己 catch。
  不要依赖 CEH 弹 Toast：它只接未捕获，而且协程已经死了。
```

自测时把其中任意一句换成「如果不用……会怎样」。讲得出坏掉的用户可见现象，这步才算过。例如不用 `flatMapLatest` 而用 `flatMapConcat`：慢的旧搜索会堵在新关键字后面，列表晚一拍且顺序是旧的。不用 `WhileSubscribed` 而用 `Eagerly`：页面进后台上游仍跟着 ViewModel 跑。`delay(0)` 写在主线程紧循环里：循环不会让出，掉帧依旧。

## 画面

```text
P0 主路径（按这个顺序讲，不要跳）

模型 basics
  挂起让出线程，续体是书签
    |
调度 dispatchers          上下文 context
  哪条线程、池的配额        Job / Dispatcher / Name / CEH
    |                         |
结构化 builders -------- 取消与异常 cancel
  launch / async / scope      协作点；普通父 vs 监督；CEH 只接根上的未捕获
    |
桥接 callback -------- Channel / Mutex
  一次回调可取消            交接 vs 互斥
    |
Flow 冷热 --------------- Android 背压与收集
  配方 vs 当前值            buffer / conflate / collectLatest
                            stateIn + WhileSubscribed
                            repeatOnLifecycle

专家加分，从模型向下钻，不代替主路径：

状态机 / CPS / COROUTINE_SUSPENDED
  -> Dispatcher 拦截 resume，所以恢复可以换线程
  -> yield 让出；delay(0) 不挂起
  -> 同线程只在挂起点切换
```

## 常见坑与追问

1. **按 API 字母表复习。** 追问：`flatMapLatest` 和取消是什么关系？答不上，是因为背压层和取消层没接上。按本篇顺序，取消在 Flow 之前。
2. **把专家加分当开场。** 追问：状态机标签讲了三分钟，面试官问 `viewModelScope` 里抛异常兄弟还在不在。P0 路径断了。机制放在追问里，第一段先讲用户可见的结构。
3. **`delay(0)` 当 `yield()`。** 追问：源码对非正延迟做什么？直接 return，不挂起，也不是取消检查点。让出用 `yield()`。见 `kp-coroutine-internals`。
4. **CEH 当成协程版 try/catch。** 追问：装在子 `launch` 上、父又是普通 `coroutineScope`，为什么不打印？异常交给父了。`viewModelScope` 因为是监督者，子协程的未捕获才会到 handler 或默认崩溃。见 `kp-coroutine-context`。
5. **StateFlow 装 Toast，旋转又弹一次。** 追问：新收集者拿到什么？当前值。一次性事件用 `replay = 0` 的 `SharedFlow`，或单消费者的 `Channel`。见 `kp-flow-backpressure-android`。
6. **`limitedParallelism(1)` 当成「永远这条线程」。** 追问：挂起之后呢？线程还给池子，恢复可能是另一条工人。互斥还在，`ThreadLocal` 不在。
7. **只背「协程不阻塞线程」。** 追问：`withContext(IO)` 里调用阻塞 SDK 时那条工人在干什么？在阻塞。挂起的是没把阻塞 API 包进协程的那些等待。协程不消灭阻塞，只是让你会把阻塞关进有配额的池子。
