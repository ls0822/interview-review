---
id: kp-flow-backpressure-android
type: knowledge
module: coroutine
title: Flow 背压、操作符与 Android 收集
priority: P0
version: 2
order: 90
requires: [kp-coroutine-flow]
---

## 一句话

冷流默认是会合：`emit` 会等这次收集处理完，这就是背压；处理不过来时要明确选择缓冲、只留最新，或取消过时的处理。Android 上再把热流的生命周期交给 `stateIn` / `shareIn` 和 `repeatOnLifecycle`，不要用 `StateFlow` 装一次性事件。

## 组成与结构

背压解决的是「生产比消费快」时谁等待、谁丢、谁取消。它和冷热是两件事情。冷热决定上游何时启动、多人收集是否各跑一遍。背压决定同一次收集里，`emit` 和 `collect` 怎么配合。

| 手段 | 生产者 | 中间值 | 典型用途 |
|------|--------|--------|----------|
| 默认 `collect` | `emit` 挂起，直到下游处理完 | 一个不丢 | 必须按顺序处理完的冷流 |
| `buffer` | 可以领先若干个；满了默认再挂起 | 先堆着 | 生产不该被下游的慢处理拖住，但不能丢 |
| `conflate` | 不等待 | 只留最新 | 进度、刷新，旧的没有意义 |
| `collectLatest` | 继续收集上游 | 取消上一值的处理块 | 搜索，新关键字作废旧请求 |

`buffer` 会让上游在另一个协程里跑，中间用 Channel 隔开，所以它不只是「多了个数组」，而是把同步会合拆成并发的两端。容量默认是 `Channel.BUFFERED`（64 这一档）。`onBufferOverflow` 为 `SUSPEND` 时，缓冲满了发送方挂起，背压还在，只是多了一段余量。`DROP_OLDEST` / `DROP_LATEST` 时发送方不再因为满而挂起，代价是丢值。`conflate()` 就是面向「只留最新」的缓冲，发送方不等。

扁平化三个操作符，差别在内部流和上一个的关系：

| 操作符 | 上一个内部流 | 顺序 | 并发 |
|--------|----------------|------|------|
| `flatMapConcat` | 等它完整结束才订下一个 | 保持外层顺序 | 1 |
| `flatMapMerge` | 不取消，一起收集 | 完成先后交错 | 默认 16，到顶则外层收集挂起 |
| `flatMapLatest` | 直接取消 | 只关心最新的外层值 | 同时只有最新那一个 |

`flowOn` 不是背压操作符，但经常和 `buffer` 写在一起。它只把上游的协程上下文换成给定的那个，下面的 `collect` 仍在收集者的协程里。实现上同样用 Channel 把两端拆开，所以上游可以跑在 IO，下游更新界面跑在 Main。上下文里禁止再放 `Job`，否则会报 Flow context cannot contain job in it，因为收集的取消必须仍然从这次 `collect` 的 Job 传进去，不能被你塞进来的 Job 截走。

`catch` 和 `retry` 是失败策略，不是背压。`catch` 只看见自己上游的异常，看不见下游 `collect` 里抛的，也不吞 `CancellationException`。`retry` / `retryWhen` 是上游失败后整段重头收集，取消同样不重试。

热流转换必须有 Scope，因为配方要变成一条真正在跑的协程：

| `SharingStarted` | 何时启动上游 | 订阅归零之后 | 再有人来 |
|------------------|----------------|----------------|----------|
| `Eagerly` | `stateIn` / `shareIn` 一调用就启动 | 继续跑，直到 Scope 取消 | 不重启，本来就没停 |
| `Lazily` | 第一个订阅者 | 继续跑到 Scope 取消 | 不重启 |
| `WhileSubscribed(stopTimeout, replayExpiration)` | 从 0 个订阅变成有人 | 空窗超过 `stopTimeout` 就取消上游 | 重新执行冷流 |

`stateIn` 得到 `StateFlow`，必有初值。`shareIn` 得到 `SharedFlow`，由 `replay` 决定新订阅者能看到几条历史。还有一个挂起版 `stateIn(scope)`：没有 `SharingStarted` 参数，它会挂起直到上游发出第一个值，再用这个值当当前值，上游按「立刻启动并一直跑」对待。非挂起版必须自己给 `initialValue` 和策略。

Android 收集侧两件套：`Lifecycle.repeatOnLifecycle(State.STARTED)` 在生命周期掉到 STARTED 以下时取消块里的协程，回到 STARTED 再执行一遍；`collectAsStateWithLifecycle` 在 Compose 里做同样的事，默认也是至少 STARTED。旧的 `launchWhenStarted` 只是把协程挂起，不取消，上游订阅读着还在，所以被弃用。

## 原理

1. **默认背压为什么是挂起而不是丢。** 冷流的 `emit` 直接调用收集者，收集者的 `collect` 块返回之后 `emit` 才返回。生产速度被消费速度卡住，内存不会因为「来不及画」而堆积。这和对 Channel 做容量 0 的会合是同一类约束。你感觉「Flow 没有背压」，通常是因为中间加了 `buffer`，或者收集块里根本没有慢活。

2. **`buffer` 把背压推迟，不是取消。** 上游领先最多 `capacity` 个值，适合「解码可以略快于渲染，但不能丢帧序列」这类。缓冲满了仍会挂起 `emit`，上游的协程停在那里，不占着傻循环。若策略改成丢弃，就要在产品上接受空洞。不要用很大的无限缓冲代替背压，那是把队列放到内存里，慢消费者会把进程撑大。

3. **`conflate` 牺牲完整性，换生产者永不被慢消费者堵住。** 收集者每处理完一次，取走这段时间里最新的那个值，中间的没有机会进入处理块。适合下载进度、传感器、已经映射成界面状态的刷新。不适合「每一条都是独立命令」的点击或消息。它仍然是冷操作符：没有 `collect` 就没有上游。不要和 `StateFlow` 混为一谈。`StateFlow` 是热的，还有 `equals` 去重和固定的当前值。

4. **`collectLatest` 牺牲的是正在进行的工作。** 新值到来，上一轮 lambda 被取消，收到的是 `CancellationException`。搜索框就靠这个：新关键字把旧请求取消。前提是 lambda 里的挂起真的响应取消。里面若是不可取消的阻塞读，或者 `catch (Exception)` 把取消吃了，旧请求会继续占着连接，界面只是「看起来」只处理最新。`mapLatest` / `flatMapLatest` 是同一机制，只是把取消包在变换里，而不是包在终端收集里。

5. **三个 `flatMap` 是三种内部流生命周期。** `flatMapConcat` 严格排队。慢的第一页不结束，第二页的请求不会发；顺序稳定，延迟会累加。`flatMapMerge` 允许多个内部流同时跑，默认并发 16，超过则收集外层的下一步会挂起，这是它的背压。结果按内部流完成的先后出来，不是按外层顺序。`flatMapLatest` 在外层每来一个新值时取消上一个内部流。搜索用 Latest，分页「必须一页接一页」用 Concat，一批独立 id 并行拉取用 Merge 并自己封顶。`flatMapMerge(concurrency = 1)` 不要拿来代替 Concat 的顺序语义，面试时直接说你要的是等完再下一个，还是允许交错。

6. **`flowOn` 的位置就是线程边界，而且只朝上游看。** 写在 `flowOn` 上面的 `map`、`filter`、`flow { }` 跑在新上下文里；写在下面的，包括 `collect`，仍在收集协程的 Dispatcher 上。连续两个 `flowOn`，各自管自己上方、直到再上一个 `flowOn` 的那一段。它不能把收集者切到 Main。收集者在哪，取决于你在哪个 Scope 里 `collect`。在 `viewModelScope`（主线程）里收集，上游 `flowOn(Dispatchers.IO)`，这是正确搭配。

7. **流的不变量：同一次收集里，`emit` 不能并发，也不能随便换协程。** `FlowCollector` 不是线程安全的。在 `flow { }` 里再 `launch { emit() }` 会违反不变量，运行时能查到来自另一个协程的发射。要在多个协程里往同一个流送值，用 `channelFlow` / `callbackFlow`，它们内部用 Channel 收口，再由收集协程串行发射。`flowOn` 是官方允许的换上下文方式，因为它把上游整段挪到另一个协程，而不是在同一次发射调用里换线程。

8. **`catch` 的边界由位置决定。** 它是一个新的上游：只捕获自己上方流里的异常，捕获后你还可以 `emit` 一个降级值。下方的操作符和 `collect` 块不属于它。取消异常会继续抛，所以空的 `catch` 并不会把取消吞掉；吞取消的通常是 `try/catch (Exception)` 或 `runCatching` 写在 `collect` 里面。`retry(n)` 在谓词为真且次数未尽时把上游从头再收集一遍。冷的网络流会因此再打一次请求。热流外面再 `retry` 往往没有「重跑源」的意义。`retryWhen` 可以在重试前 `delay` 做退避，返回 false 则异常继续往下。不要无延迟地无限重试，那会打满 CPU 或把服务打满。

9. **`stateIn` 把收集者的生命周期从界面上拆下来。** 冷流如果在 `repeatOnLifecycle` 里直接 `collect`，每次 STARTED 都重跑上游，旋转会重新请求，这有时是对的。若多个界面要同一份数据，或你希望 STOPPED 的短时间内不要取消正在进行的刷新，就在 `viewModelScope` 里 `stateIn` 成 `StateFlow`。上游协程是 ViewModel 的孩子，跟随 `SharingStarted`，不跟随某一个 Composable。上游在 `stateIn` 之前失败且没有 `catch`，共享协程以异常结束。`viewModelScope` 是 `SupervisorJob`，这个失败不会取消旁边的协程，但会变成未捕获，调试时可能崩溃，`StateFlow` 也不再更新。所以把失败 `emit` 成错误态的 `catch` 要放在 `stateIn` 前面。

10. **三种 `SharingStarted` 对应三种产品寿命。** `Eagerly`：ViewModel 一创建就订阅数据库或位置，即使用户还没进这个页面，退到后台也不停，直到 ViewModel 清除。适合会话级、本来就要一直在的事实。`Lazily`：第一次有界面看才启动，但之后退后台也不停。比 Eagerly 少一次「用户从没打开这个页」的浪费，退后台该停的时候它不停。`WhileSubscribed(5_000)`：最后一个收集者消失后等 5 秒再取消上游；5 秒内又有人（旋转、短暂跳到权限页）就当没断过，避免加载闪烁和重复请求。停更久，上游取消，省电省连接。`StateFlow` 仍保留最后的值，界面回来先画旧状态，上游重新收集后再刷新。`replayExpiration` 默认很长，缓存一直留到 Scope 结束；若你希望停掉之后把状态打回初值，才把这个时间设短。`shareIn` 的 `replay = 0` 则新订阅者看不到停掉之前的事件。

11. **`repeatOnLifecycle` 取消的是收集，不只是「先别画」。** 块里的协程在 `ON_STOP` 被取消，`collect` 因此结束，`WhileSubscribed` 的订阅计数下降。这是一条链：生命周期，取消收集协程，订阅归零，超时后取消上游，上游里的挂起请求在协作点退出。`launchWhenStarted` 不断这条链，因为协程还活着，只是挂起，订阅者还在。`repeatOnLifecycle` 这个挂起函数要到 `DESTROYED` 才返回，所以外层 `launch` 应放在 `lifecycleScope`，让界面销毁时外层也结束。收集必须写在块的里面。写在外面，STOP 时根本没人取消它。

12. **Compose 的两个收集。** `collectAsState` 在组合还在时就收集，页面停在后台、组合没离开，收集还在，上游也停不下来。`collectAsStateWithLifecycle` 用生命周期把收集限制在至少 STARTED，和 `repeatOnLifecycle` 对齐。需要生命周期所有者。初值可以用 `StateFlow.value`，这样第一帧就是当前状态，而不是再造一个加载占位。它解决的是「何时订阅」，不解决「事件该不该重放」。

13. **`StateFlow` 为什么不适合一次性事件。** 它永远有当前值，新收集者（旋转、从后台回来、新的 `collect`）会立刻拿到这一份。Toast、导航、Snackbar 若被存成当前值，就会再执行一次。第二条：更新用 `equals` 去重，同一个单例对象，或者文案相同的 data class，第二次点击不会通知。第三条：它是广播，每个收集者都拿到，没有「被一个消费者取走即消失」。正确的一次性通道是 `MutableSharedFlow`，`replay = 0`，`extraBufferCapacity = 1`，在点击这种非挂起上下文里 `tryEmit`。`replay = 0` 表示后来的收集者看不到已经发出、且当时没人收的事件。`extraBufferCapacity` 是给当前慢订阅者的余量，不是给未来订阅者的重放；容量至少 1，`tryEmit` 在「挂起策略且缓冲为 0」时会失败，因为 `tryEmit` 不允许挂起。另一种是 `Channel` 再 `receiveAsFlow()`：每个事件只交给一个消费者。发送时若没人收，要看容量，可能挂起、可能丢、也可能堆在 Channel 里等下一次收集。旋转期间没人收，Channel 有缓冲就会把导航留到回来再执行，这可能是想要的（别漏跳转），也可能是过期跳转。`SharedFlow(replay = 0)` 在没人订阅时把事件丢掉，更适合「用户没在看就不要再弹」。

14. **和 Channel 怎么选。** Flow 是可重复的配方，操作符链、冷启动、多个收集者各跑一遍，选它。`StateFlow` 是可重放的当前状态，多订阅者看同一份，选它。需要最新、可丢中间值的界面状态，优先 `StateFlow` 或冷流上的 `conflate`，不要自己用汇合 Channel 再桥一层，除非生产者根本不是协程。命令、点击、一次性导航：`replay = 0` 的 `SharedFlow`，或单消费者的 `Channel`。工作队列要「每条恰好被一个工人处理」、还要 `close` 传递结束：用 `Channel`，不要用会被两个 `collect` 各跑一遍的冷 Flow。回调转成流，多次回调用 `callbackFlow`（每次收集注册，`awaitClose` 反注册），它对外仍是冷流。不要用裸 Channel 当全应用事件总线，所有权不清，也容易变成没人 `close` 的热源。

## 使用与实践

搜索页可以收成一条上游，错误变成状态，而不是变成未捕获异常：

```kotlin
val ui: StateFlow<UiState> = query
    .debounce(300)
    .map { it.trim() }
    .distinctUntilChanged()
    .flatMapLatest { q -> flow { emit(repo.search(q)) } }
    .flowOn(Dispatchers.IO)
    .map<List<Item>, UiState> { UiState.Data(it) }
    .catch { emit(UiState.Error(it)) }
    .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), UiState.Loading)

private val _toast = MutableSharedFlow<String>(
    replay = 0,
    extraBufferCapacity = 1
)
fun onSaveFailed(msg: String) { _toast.tryEmit(msg) }
```

`flatMapLatest` 里的 `repo.search` 必须是可取消的挂起。`debounce` 用的是 `delay`，时钟来自它所在的那一段上下文；放在 `flowOn` 上面就在 IO 的调度器上计时，放在下面就跟收集者走。不要在 `debounce` 的上游做重活。

界面：

```kotlin
viewLifecycleOwner.lifecycleScope.launch {
    viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
        viewModel.ui.collect { render(it) }
    }
}
```

Compose 里对 `ui` 使用 `collectAsStateWithLifecycle()`。Toast 用 `repeatOnLifecycle` 里单独 `collect` 那个 `SharedFlow`，不要并进 `UiState` 的一个会被重放的字段。

操作符选择口诀，能讲出牺牲了什么再写代码。每一项都不能丢：默认会合或 `flatMapConcat`。可以丢中间状态：`conflate` 或 `StateFlow`。旧工作应当取消：`collectLatest` / `flatMapLatest`。可以并行但要封顶：`flatMapMerge(concurrency)`。生产略快于消费又不允许丢：有限 `buffer`。

`flowOn` 不要传入 `Job` 或 `SupervisorJob`。取消结构保持为「收集协程是父」。需要在上游里面开子协程，用 `channelFlow` 的协程作用域，它会等子协程，并在收集取消时一起取消。

重试放在仍是冷流的那一段，并带退避。`retry` 本身不会重试取消。不要对已经 `stateIn` 之后的热流 `retry`，那时你重试的是收集热流，不是重新执行原来的请求。谓词里对取消直接再抛，只对 `IOException` 在次数内 `delay` 后返回 true。

## 例子

慢消费者配三种背压，行为不同：

```kotlin
fun ticks() = flow {
    repeat(3) {
        emit(it)
        println("emitted $it")
    }
}

// 会合：emitted 0 要等 collect 里的 delay 结束才发 1
ticks().collect { delay(100); use(it) }

// 缓冲：emit 可以先跑完，use 随后慢慢消费
ticks().buffer(8).collect { delay(100); use(it) }

// 合并：use 每次只看到当时最新的，中间值可以没有
ticks().conflate().collect { delay(100); use(it) }

// 取消旧处理：新的 emit 会取消还在 delay 的上一轮 lambda
ticks().collectLatest { delay(100); use(it) }
```

旋转和退后台（`WhileSubscribed(5_000)`，收集在 `repeatOnLifecycle(STARTED)` 里）：

```text
STARTED  collect 开始，订阅数 1，上游启动
STOPPED  收集协程取消，订阅数 0，开始 5 秒计时，StateFlow 的值还在
300ms 后又 STARTED（旋转）  计时取消，上游没断，界面直接拿当前值
STOPPED 超过 5 秒          上游协程取消，请求在挂起点退出
再次 STARTED               冷流重新执行，先显示留下的旧值，再来新值
```

若策略是 `Eagerly`，上面每一次 STOPPED 上游都不停。若在界面里直接收集冷流、没有 `stateIn`，每一次重新 STARTED 都会新开一次请求，没有「旧值先顶上」这回事，除非你自己把最后一帧存在别处。

`Channel` 和 `SharedFlow` 对同一次点击的差别：`Channel.trySend` 把事件交给单个消费者，容量满了要看这次发送的结果，可能丢。`MutableSharedFlow.tryEmit`（`replay = 0`，额外缓冲 1）让当时所有订阅者都收到；当时没人订阅则这次没了。两个界面同时收集 Channel 转成的流，事件会被分给其中一边，不是各拿一份。两个界面收集 `SharedFlow`，才会各拿一份。状态用 `StateFlow`；「只处理一次的工作队列」用 `Channel`。

## 画面

```text
冷流收集

emit ---- 默认：等 collect 块返回 ----> 界面
       \
        +-- buffer：Channel 余量，满了再等
        +-- conflate：槽里只留最新，emit 不等
        +-- collectLatest：新值取消上一块

flowOn(IO) 的上方在 IO 协程
flowOn 的下方，含 collect，仍在收集者的线程

stateIn(viewModelScope, WhileSubscribed)
        |
        v
     StateFlow（当前值，equals 去重）
        |
        +-- repeatOnLifecycle(STARTED) / collectAsStateWithLifecycle
                 |
                 STOP：取消收集，订阅归零，超时后取消上游

一次性事件不要进这张 StateFlow
        |
        +-- SharedFlow(replay = 0)  没人看就丢，适合 Toast
        +-- Channel                  恰好一个消费者，适合工作队列
```

## 常见坑与追问

1. **「加了 `buffer` 就不会再挂起。」** 追问溢出策略。默认是挂起，满了仍挂起。只有丢弃策略或 `conflate` 才让 `emit` 不等。无限缓冲会把背压变成内存问题。
2. **「`collectLatest` 了，旧网络一定会停。」** 追问处理块里有没有协作点，`catch (Exception)` 有没有把 `CancellationException` 吃掉。没有协作点，取消只是标记。
3. **「`flowOn(Main)` 我就能在上游改 View。」** `flowOn` 改的是上游。改 View 放在 Main 上的 `collect` 里。另外不要把 `Job` 放进 `flowOn`。
4. **「`catch` 能接住收集者里的崩溃。」** 接不住。它只包上游。收集块里的异常要在 `collect` 外或块内处理，并且不要吞取消。
5. **「`stateIn` 之后再 `catch`。」** 太晚。共享协程已经因为异常结束。`catch` 放在 `stateIn` 前，把错误发射成状态。
6. **「用了 `Lazily`，退后台就不用担心定位还在跑。」** `Lazily` 和 `Eagerly` 一旦启动就跟到 Scope 取消，也就是 ViewModel 清除，不是 `ON_STOP`。要跟界面可见性，用 `WhileSubscribed` 再加上会在 STOP 时取消收集的那一侧。
7. **「`launchWhenStarted` 和 `repeatOnLifecycle` 一样省电。」** 前者不取消协程，订阅还在，`WhileSubscribed` 的计时不会开始。用 `repeatOnLifecycle` 或 `collectAsStateWithLifecycle`。
8. **「Toast 放进 `StateFlow`，显示完置 null。」** 置 null 和收集之间有竞态；旋转后新收集者会再次拿到还没置空的事件；相同内容的第二次还会被 `equals` 吃掉。用 `replay = 0` 的 `SharedFlow`。
9. **「`tryEmit` 失败我就改成 `emit`。」** 点击回调不是挂起函数，不能 `emit`。失败说明缓冲是 0 且策略是挂起。给 `extraBufferCapacity`，或接受丢弃并处理 `tryEmit` 的返回值。
10. **「一个冷 Flow 让两个工人 `collect`，队列就不会重复执行。」** 冷流每人跑一遍上游，工作会做两次。恰好一次的队列用 `Channel`，一个消费者。
