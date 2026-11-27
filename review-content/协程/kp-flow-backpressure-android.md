---
id: kp-flow-backpressure-android
type: knowledge
module: coroutine
title: Flow 背压、操作符与 Android 收集
priority: P0
version: 5
order: 90
requires: [kp-coroutine-flow, kp-coroutine-state-shared-flow]
---

## 一句话

冷流默认**会合**：`emit` 等这次 `collect` 处理完，这就是背压。处理不过来时要**显式**选缓冲、只留最新，或取消过时处理。Android 上再把热流寿命交给 `stateIn`/`shareIn` 和 `repeatOnLifecycle`；**不要**用 `StateFlow` 装一次性事件。

## 组成与结构

背压管「生产比消费快时谁等、谁丢、谁取消」。冷热管「何时启动、多人是否各跑一遍」——**两件事，别揉一起**。

| 手段 | 生产者 | 中间值 | 典型用途 |
|------|--------|--------|----------|
| 默认 `collect` | `emit` 挂起直到下游处理完 | 一个不丢 | 必须按序处理完的冷流 |
| `buffer` | 可领先若干；满了默认再挂起 | 先堆着 | 生产略快于消费但不能丢 |
| `conflate` | 不等待 | 只留最新 | 进度、传感器刷新 |
| `collectLatest` | 继续收上游 | 取消上一值的处理块 | 搜索，新关键字作废旧请求 |

`flatMapConcat` / `Merge` / `Latest`：上一个内部流是等完、并行还是取消——见原理单元。

`SharingStarted` 与 `stateIn`/`shareIn`、`repeatOnLifecycle` 与 `collectAsStateWithLifecycle`——表意保留在使用段。

**关系一句：** 操作符链解决「一次收集里快慢怎么配」；`stateIn` + 生命周期解决「界面不见时谁还在跑」。

先修：`kp-coroutine-flow`。Channel 对照：`kp-coroutine-channel-mutex`。

## 原理

### 1. 默认背压：挂起，不是丢

**是什么：** `emit` 直接驱动收集块；块返回后 `emit` 才返回。生产被消费卡住，不会因「来不及画」堆无限值。

**看代码：**

```kotlin
flow { repeat(3) { emit(it); println("emitted $it") } }
    .collect { delay(100); use(it) } // 发 1 要等 use(0) 完
```

**和谁有关：** 与 `Channel` 容量 0 会合同族。觉得「Flow 没背压」常因加了 `buffer` 或 collect 里没有慢活。

**别混：** 默认会合 ≠ 性能差；是语义选择。

### 2. `buffer`：推迟背压，不取消

**是什么：** 上游可领先最多 `capacity` 个；满了仍挂起 `emit`。实现上用 Channel 隔开两端，上游可在另一协程跑。

**看代码：**

```kotlin
ticks().buffer(8).collect { delay(100); use(it) } // emit 可先跑完
```

**和谁有关：** `onBufferOverflow` 为 `DROP_OLDEST`/`DROP_LATEST` 时发送方不必因满挂起，代价是丢值。

**别混：** 很大或无限 `buffer` 是把队列放进内存，不是消灭背压。

### 3. `conflate`：牺牲完整性，生产者不等

**是什么：** 收集者每次处理完，取这段时间里**最新**的那个值；中间的进不了处理块。

**看代码：**

```kotlin
ticks().conflate().collect { delay(100); use(it) }
```

**和谁有关：** 下载进度、已映射成 UI 的刷新。独立命令（每条点击）不适合。

**别混：** 仍是冷操作符；没 `collect` 就没上游。不是 `StateFlow`（热 + equals 去重）。

### 4. `collectLatest`：取消正在进行的工作

**是什么：** 新值到来，上一轮 lambda 被取消（`CancellationException`）。块里必须有**可取消的挂起点**。

**看代码：**

```kotlin
ticks().collectLatest { delay(100); use(it) } // 新 emit 取消还在 delay 的上一轮
```

**和谁有关：** 搜索框 + `flatMapLatest` 同机制。见 `kp-coroutine-cancel` 协作点。

**别混：** `catch (Exception)` 吃掉取消 → 旧请求继续占连接。

### 5. 三种 `flatMap` 怎么选

**是什么：** Concat 严格排队；Merge 多内部流并发（默认 16，到顶外层 collect 挂起）；Latest 新外层值取消旧内部流。

**看代码：**

```kotlin
.flatMapLatest { q -> flow { emit(repo.search(q)) } } // 搜索
.flatMapConcat { page -> flow { emit(loadPage(page)) } } // 分页顺序
.flatMapMerge(concurrency = 8) { id -> flow { emit(fetch(id)) } } // 并行 id
```

**和谁有关：** `flatMapMerge(concurrency = 1)` **不能**代替 Concat 的顺序语义。

**别混：** Merge 完成先后交错，不是外层顺序。

### 6. `flowOn`：上游边界与 Job 禁令

**是什么：** 写在 `flowOn` 上面的跑在新上下文；下面的含 `collect` 仍在收集者 Dispatcher。`flowOn` 里不能放 `Job`，否则取消链被截断。

**看代码：**

```kotlin
raw.flowOn(Dispatchers.IO) // 不要 flowOn(Dispatchers.IO + Job())
    .collect { render(it) }
```

**和谁有关：** `kp-coroutine-flow` 单元 2。

**别混：** 连续两个 `flowOn` 各管自己到上一个 `flowOn` 之间的段。

### 7. `catch` / `retry` 的边界

**是什么：** `catch` 只捕获**自己上方**流的异常，还可 `emit` 降级值。看不见 `collect` 里抛的。`retry` 整段重头收集；**取消不重试**。

**看代码：**

```kotlin
.catch { emit(UiState.Error(it)) }
    .stateIn(...) // catch 必须在 stateIn 前
```

**和谁有关：** 冷网络流 `retry(n)` 会再打请求；热流外 `retry` 往往没「重跑源」意义。

**别混：** 空 `catch` 不吞取消；吞取消多在 `collect` 里 `catch (Exception)`。

### 8. `stateIn` 拆掉「收集者 = 界面」

**是什么：** 冷流在 `repeatOnLifecycle` 里直接 `collect`，每次 STARTED 可能重跑上游。多界面同一份数据或 STOP 短暂不想掐刷新 → ViewModel 里 `stateIn` 成 `StateFlow`。

**看代码：**

```kotlin
query.debounce(300).flatMapLatest { ... }
    .catch { emit(UiState.Error(it)) }
    .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), Loading)
```

**和谁有关：** 上游失败无 `catch` → 共享协程异常结束；`SupervisorJob` 下兄弟还在但未捕获可能崩。

**别混：** `stateIn` **之后**再 `catch` 无效。

### 9. `SharingStarted` 三种产品寿命

**是什么：** `Eagerly`：ViewModel 活着就跑。`Lazily`：首个订阅才启动，之后跟到 Scope 取消。`WhileSubscribed(5_000)`：订阅归零后等 5 秒停上游，旋转 5 秒内不断。

**看代码：**

```kotlin
SharingStarted.WhileSubscribed(5_000)
```

**和谁有关：** `repeatOnLifecycle` STOP → 收集取消 → 订阅归零 → 计时开始。

**别混：** `Lazily`/`Eagerly` 退后台**不停**上游；要跟可见性用 `WhileSubscribed` + 生命周期收集。

### 10. `repeatOnLifecycle` 取消的是收集

**是什么：** 块内协程在低于 STARTED 被取消，`collect` 结束，`WhileSubscribed` 计数降。`launchWhenStarted` 只挂起不取消，订阅还在。

**看代码：**

```kotlin
lifecycleScope.launch {
    repeatOnLifecycle(STARTED) {
        vm.ui.collect { render(it) }
    }
}
```

**和谁有关：** 外层 `launch` 放 `lifecycleScope`，DESTROYED 时外层也结束。

**别混：** `collect` 必须写在块**里面**；写外面 STOP 时没人取消。

### 11. StateFlow 不适合一次性事件

**是什么：** 总有当前值，新收集者立刻拿到；`equals` 去重；广播没有「被一个消费者取走即消失」。

**看代码：**

```kotlin
// 对：Toast
MutableSharedFlow<String>(replay = 0, extraBufferCapacity = 1)
// 或 Channel + 单消费者（工作队列，不是广播）
```

**和谁有关：** `kp-coroutine-channel-mutex` 里 Channel vs SharedFlow。

**别混：** `StateFlow` 里 toast 置 null 与收集有竞态；相同文案第二次可能被 equals 吞。

## 使用与实践

### 搜索页一条上游

**是什么：** `debounce` + `distinctUntilChanged` + `flatMapLatest` + `flowOn(IO)` + `catch` + `stateIn(WhileSubscribed)`。Toast 旁路 `SharedFlow`。

**看代码：**

```kotlin
val ui: StateFlow<UiState> = query.debounce(300).distinctUntilChanged()
    .flatMapLatest { q -> flow { emit(repo.search(q)) } }
    .flowOn(Dispatchers.IO)
    .map { UiState.Data(it) }
    .catch { emit(UiState.Error(it)) }
    .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), UiState.Loading)
```

**和谁有关：** `repo.search` 必须可取消挂起。`debounce` 用 `delay`，上下文跟所在段走。

**别混：** `debounce` 上游不要做重活。

### 操作符口诀（先讲牺牲什么）

**是什么：** 每项不能丢 → 默认会合或 `flatMapConcat`。可丢中间 → `conflate`/`StateFlow`。旧工作应取消 → `collectLatest`/`flatMapLatest`。可并行封顶 → `flatMapMerge`。略快不丢 → 有限 `buffer`。

**和谁有关：** 本篇原理 1–5。

**别混：** 两个工人各自 `collect` 同一冷流 → 工作做两次；恰好一次用 `Channel`。

### Compose 与重试

**是什么：** `collectAsStateWithLifecycle` 默认至少 STARTED。重试放在仍是冷流的一段，带退避；谓词里对取消再抛。

**看代码：**

```kotlin
.retry(3) { e, attempt ->
    if (e is CancellationException) throw e
    e is IOException && attempt < 3
}
```

**别混：** 对已 `stateIn` 的热流 `retry` 不是重跑原来那次请求。

## 例子

旋转 + `WhileSubscribed(5_000)` + `repeatOnLifecycle`（口述时间线，不重复 ticks 代码）：

```text
STARTED → collect，订阅 1，上游启动
STOPPED → 收集取消，订阅 0，5 秒计时；StateFlow 值还在
<5s 又 STARTED → 计时取消，上游未断
STOPPED >5s → 上游取消；再 STARTED → 冷流重跑，先旧值后新值
```

**错：** Composable 里直接 `collect` 冷流。  
**对：** `stateIn` + `collectAsStateWithLifecycle`。

**错：** Navigation 写进 `StateFlow.copy(navTarget=…)`，后台回来又 navigate。  
**对：** `replay=0` 的 `SharedFlow`。

## 画面

```text
emit ---- 默认：等 collect 返回
        +-- buffer：Channel 余量，满了再等
        +-- conflate：槽里只留最新
        +-- collectLatest：新值取消上一块

stateIn(WhileSubscribed) → StateFlow
        → repeatOnLifecycle / collectAsStateWithLifecycle
STOP：取消收集 → 订阅 0 → 超时取消上游

一次性事件不进 StateFlow → SharedFlow(replay=0) 或 Channel 单消费者
```

## 常见坑与追问

1. **加了 `buffer` 就不会再挂起。** 追问：默认溢出策略？满了仍挂起；只有丢弃或 `conflate` 才让 emit 不等。
2. **`collectLatest` 旧网络一定停。** 追问：处理块有没有协作点？有没有吞取消？
3. **`flowOn(Main)` 在上游改 View。** 追问：改 View 在 Main 的 `collect` 里；`flowOn` 别塞 `Job`。
4. **`catch` 接收集者崩溃。** 接不住；只包上游。
5. **`stateIn` 之后再 `catch`。** 太晚；共享协程已死。
6. **`Lazily` 退后台就不用担心定位还在跑。** 追问：跟到 Scope 取消，不是 `ON_STOP`。
7. **`launchWhenStarted` 和 `repeatOnLifecycle` 一样省电。** 前者不取消收集，订阅不减。
8. **Toast 进 StateFlow 显示完置 null。** 竞态 + 旋转重放；用 `SharedFlow(replay=0)`。
9. **`tryEmit` 失败改 `emit`。** 点击非挂起；给 `extraBufferCapacity` 或处理返回值。
10. **两个工人 `collect` 同一冷流不重复执行。** 冷流每人跑一遍；队列用 `Channel` 单消费者。
