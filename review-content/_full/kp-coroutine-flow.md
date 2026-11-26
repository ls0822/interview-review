---
id: kp-coroutine-flow
type: knowledge
module: coroutine
title: Flow 冷热流、StateFlow 与 replay
priority: P0
version: 1
---

## 一句话

`flow { }` 是冷流，有人 `collect` 才从头生产，每人一份；`StateFlow` 和 `SharedFlow` 是热流，数据独立于某个收集者存在，新订阅者能拿到的历史由当前值或 `replay` 决定。

## 组成与结构

| | 冷流 | 热流 |
|--|------|------|
| 何时生产 | `collect` 时执行上游 | 可以在没人收集时就 `emit` / 改 `value` |
| 多个收集者 | 通常各自跑一遍上游 | 共享同一份上游 |
| 类比 | 点播 | 直播 |
| 代表 | `flow { }`、`flowOf`、多数 Retrofit 返回的 Flow | `StateFlow`、`SharedFlow` |

`StateFlow` 三条硬规定：构造时必须有初值；新收集者马上收到当前值；`equals` 相同的新值不再通知。适合界面状态。

`SharedFlow` 用参数调节：

| 参数 | 给谁 |
|------|------|
| `replay` | 新订阅者先拿到最近 N 条 |
| `extraBufferCapacity` | 已经在听的人一时处理不过来时先堆着 |
| `onBufferOverflow` | 缓冲满了：挂起发送方、丢最旧、丢最新 |

总缓冲可以理解成重放槽加额外槽。`replay` 不是「在线观众的队列」。

操作符 `map` / `filter` / `debounce` 仍是冷的，直到收集。`stateIn` / `shareIn` 把冷流转成热流，必须带一个 Scope，因为热流背后要有协程跑上游。

## 原理

1. **冷流每次收集都执行块。** `flow { emit(api()) }` 被收集两次就请求两次。上游抛异常，这次收集失败，不影响下一次重新收集。没人收集，块里的代码一行都不跑。
2. **flowOn 只影响上游。** 它上面的生产切到给定 Dispatcher，下面的 `collect` 仍在收集者的协程上。它不是 `withContext` 的别名，也不能用来切换收集者。在 Main 上 `collect`，在 `flowOn(IO)` 上面做阻塞读，这是正确搭配。
3. **StateFlow 的更新。** `value =` 或 `update { }` 是同步改当前值。`update` 用比较并设置，适合「读旧值再算新值」。相同 equals 不发给订阅者，所以状态要用 `data class`，不要用改内部字段却不换对象的办法假装更新。新界面旋转后重新收集，立刻拿到当前值，不必等下一次网络返回。
4. **replay 的时间线。** `replay = 2` 时，已经发出 A B C D，缓冲里留 C、D。此时新来的收集者先收到 C、D，再收之后的新值。老订阅者不会因此再收一遍历史。`replay = 0` 时，晚到的人只收订阅之后的发射；当时没人在听，这条就丢了。
5. **溢出策略。** 默认挂起 `emit`，发送方等消费者。`tryEmit` 在缓冲满且策略是挂起时会返回 false，因为它不能挂起。事件用 `tryEmit` 时要配 `extraBufferCapacity`，否则没人收集或缓冲为 0 就会丢。`DROP_OLDEST` 适合「只关心最新进度」。
6. **flatMap 三种。** `flatMapConcat` 一个接一个，保序。`flatMapMerge` 并发收集多个内部流。`flatMapLatest` 新值到来就取消上一个内部流，搜索联想用它，避免旧关键字的响应后到却覆盖新结果。

冷流转热：`stateIn(scope, SharingStarted.WhileSubscribed(5_000), 初值)` 在有订阅者时才跑上游，最后一个订阅者离开后再等 5 秒停掉，避免旋转瞬间把请求掐掉。`SharingStarted.Eagerly` 则 Scope 活着就一直跑。

## 使用与实践

界面状态放 `StateFlow`，`repeatOnLifecycle` 里收集。一次性 Toast、导航不要放 `StateFlow`：旋转后新界面会再次收到当前值，Toast 再弹一次。两种处理：用 `replay = 0` 且当时确实有收集者的 `SharedFlow`；或把事件放进状态的 `pendingToast`，界面展示后回调 `onToastShown()` 清成 null。第二种旋转不丢、也不重复。

不要在 Composable 组合过程里 `collect`。用 `collectAsStateWithLifecycle()`。

背压：冷流的 `emit` 在收集者处理完之前会挂起，这是自然减速。热流若用 `tryEmit` 且缓冲为 0，慢消费者会丢事件。要分清你要的是减速还是丢旧。

`catch` 放在收集之前能接住上游异常。放在 `collect` 后面接不住收集者自己抛的。`onCompletion` 做收尾。

## 例子

```kotlin
private val _state = MutableStateFlow(UiState.Loading)
val state: StateFlow<UiState> = _state

private val _events = MutableSharedFlow<UiEvent>(
    replay = 0,
    extraBufferCapacity = 1
)

fun search(q: String) = viewModelScope.launch {
    flow { emit(api.search(q)) }
        .flowOn(Dispatchers.IO)
        .collect { _state.value = UiState.Ok(it) }
}

fun toast(msg: String) {
    _events.tryEmit(UiEvent.Toast(msg))
}
```

搜索取消旧请求：

```kotlin
query
    .debounce(300)
    .flatMapLatest { q -> flow { emit(api.search(q)) }.flowOn(Dispatchers.IO) }
    .collect { show(it) }
```

StateFlow 去重依赖 equals。`data class Ok(val items: List<Item>)` 可以；在同一个 `MutableList` 里 `add` 再把同一个 state 对象塞回去，equals 可能仍为 true 或引用根本没变，界面不刷新。

## 画面

```text
冷流：collect 才执行
  收集者1 -> 上游跑一遍
  收集者2 -> 上游再跑一遍

热流 SharedFlow(replay=2)
  emit A B C D
  缓冲 [C, D]
  新收集者先拿 C、D，再拿之后的 E

StateFlow：永远有一个当前值，相同值不重复发
```

## 常见坑与追问

1. **两次 collect 打了两次网，觉得是 bug。** 追问：冷流的定义？有人收集才生产，且默认不共享。要共享用 shareIn。
2. **Toast 放进 StateFlow，旋转又弹。** 追问：为什么？新收集者立刻收到当前值。改成一次性通道或消费后清空。
3. **flowOn 放在 collect 后面指望切收集线程。** 追问：它管哪一段？只管它上面的上游。收集线程由收集所在的协程决定。
4. **tryEmit 事件总是丢。** 追问：replay 和 extra 都是 0 且没人挂起接收时会怎样？tryEmit 失败。给 extraBufferCapacity，或在协程里 emit。
