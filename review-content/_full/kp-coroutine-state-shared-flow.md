---
id: kp-coroutine-state-shared-flow
type: knowledge
module: coroutine
title: StateFlow、SharedFlow 与 replay
priority: P0
version: 1
order: 85
requires: [kp-coroutine-flow]
---

## 一句话

`StateFlow` 是「永远有一个当前值」的热状态；`SharedFlow` 是可配置历史（`replay`）与缓冲的热事件/数据通道。  
两者都是热流——先搞清 `kp-coroutine-flow` 的冷热，再记本篇三条 State 规则和 replay 时间线。

## 组成与结构

| | StateFlow | SharedFlow |
|--|-----------|------------|
| 有没有「当前值」 | 必须有初值 | 可以没有；靠 `replay` 缓冲 |
| 新订阅者先拿到什么 | **立刻**当前值 | 最近 `replay` 条（可为 0） |
| 相同内容还发吗 | `equals` 相同不通知 | 不按 equals 去重（除非你自己做） |
| 典型用途 | 界面 UiState | Toast/导航事件，或带历史的事件流 |

**关系一句：** 状态用 StateFlow；一次性事件用 `SharedFlow(replay=0)`（或 Channel）；不要把 Toast 塞进 StateFlow。

先修：`kp-coroutine-flow`。Android 收集与背压：`kp-flow-backpressure-android`。

## 原理

### 1. StateFlow 三条硬规定

**是什么：** ① 必有初值；② 新收集者**立刻**收到当前值；③ `equals` 相同不再通知。

**看代码：**

```kotlin
private val _state = MutableStateFlow(UiState.Loading)
val state: StateFlow<UiState> = _state

_state.update { it.copy(items = it.items + one) } // data class 新列表
```

**和谁有关：** Compose：`collectAsStateWithLifecycle()`，见使用段与 `kp-flow-backpressure-android`。

**别混：** 在同一 `MutableList` 里 `add` 再赋回同一引用，`equals` 可能不变，界面不刷新。

### 2. SharedFlow 的 replay 时间线

**是什么：** `replay = 2` 表示缓冲里最多留给**新订阅者**最近 2 条。已发 A B C D 后缓冲是 C、D；新人先收 C、D，再收之后的 E。**老订阅者不会**再收一遍历史。

**看代码：**

```kotlin
val events = MutableSharedFlow<Event>(
    replay = 2,
    extraBufferCapacity = 0,
)
```

**和谁有关：** `replay = 0`：晚到的人只收订阅**之后**的发射；当时没人听就没了（再配 `extraBufferCapacity` 给已订阅者喘口气）。

**别混：** `replay` 不是「在线观众排队」；是给**新订阅者**的快照槽。

### 3. `extraBufferCapacity` 与 `tryEmit`

**是什么：** `extraBufferCapacity` 给**已订阅、一时处理不过来**的人堆数据。`tryEmit` 不能挂起：缓冲满且策略是挂起时返回 `false`。

**看代码：**

```kotlin
private val _events = MutableSharedFlow<UiEvent>(
    replay = 0,
    extraBufferCapacity = 1,
)
fun toast(msg: String) { _events.tryEmit(UiEvent.Toast(msg)) }
```

**和谁有关：** 点击回调（非挂起上下文）发事件常用 `tryEmit`。

**别混：** `replay` 和 `extra` 都是 0、又没人在收时，`tryEmit` 很容易失败。

### 4. 溢出策略只管「满了怎么办」

**是什么：** `onBufferOverflow`：挂起等待 / 丢最旧 / 丢最新。它不改变「冷还是热」，只改变挤兑时的取舍。

**看代码：**

```kotlin
MutableSharedFlow<Int>(
    replay = 0,
    extraBufferCapacity = 16,
    onBufferOverflow = BufferOverflow.DROP_OLDEST,
)
```

**和谁有关：** 与 Flow 操作符背压（`buffer`/`conflate`）不同层，见 `kp-flow-backpressure-android`。

**别混：** 选了 DROP 就接受丢事件；UI 事件通道通常 `replay=0` + 小 `extra` + 偶尔丢也可以接受。

### 5. 为什么 Toast 不能进 StateFlow

**是什么：** 新收集者会立刻拿到当前值。旋转或重进后，`toast="已保存"` 还在 → 再弹一次。

**看代码：**

```kotlin
// 错
data class UiState(val toast: String? = null)
_state.update { it.copy(toast = "已保存") }

// 对
_events.tryEmit(UiEvent.Toast("已保存"))
```

**和谁有关：** 导航、SnackBar 同理；或状态里带一次性字段但展示后必须清掉（仍易竞态，优先事件流）。

**别混：** StateFlow 适合「现在屏幕长什么样」，不适合「响一次的副作用」。

## 使用与实践

### 页面状态：StateFlow + 生命周期

**是什么：** ViewModel 暴露 `StateFlow<UiState>`；Compose 用 `collectAsStateWithLifecycle()`。

**看代码：**

```kotlin
val ui: StateFlow<UiState> = _ui
// Composable: val state by ui.collectAsStateWithLifecycle()
```

**和谁有关：** `repeatOnLifecycle` 见 `kp-flow-backpressure-android`。冷流何时升热见 `kp-coroutine-flow`。

**别混：** 裸 `collectAsState` 在后台仍可能收集；要对齐生命周期用 WithLifecycle。

### 事件通道：SharedFlow(replay=0)

**是什么：** Toast / 导航单独一条热通道，与状态流分开。

**看代码：**

```kotlin
viewModelScope.launch {
    _events.collect { event ->
        when (event) {
            is UiEvent.Toast -> snackbar.show(event.msg)
            is UiEvent.Go -> nav.navigate(event.route)
        }
    }
}
```

**和谁有关：** 也可用 `Channel` 单消费者；多订阅者展示层再评估。

**别混：** 不要把事件又 merge 进 StateFlow「图省事」。

## 例子

**错：** `UiState.toast` 旋转后再弹。  
**对：** `SharedFlow(replay=0, extraBufferCapacity=1)` + `tryEmit`。

**错：** `replay=2` 当成「两个在线观众的队列」。  
**对：** 问新人进场先看到哪两条历史。

**错：** 改 `StateFlow` 时 mutate 同一个 list 引用。  
**对：** `copy(items = items + x)` 或新列表，让 `equals` 变。

## 画面

```text
StateFlow
  永远有一个当前值 ●
  新 collect → 立刻拿到 ●
  equals 相同 → 不通知

SharedFlow(replay=2)
  emit A B C D → 槽里 [C,D]
  新 collect → 先 C、D，再收之后的
  老 collect → 不会重放历史

事件：replay=0 + extra≥1 + tryEmit
状态：StateFlow
```

## 常见坑与追问

1. **Toast 进 StateFlow，旋转又弹。** 新收集者立刻拿当前值。
2. **`replay` 当观众队列。** 是给新订阅者的历史槽。
3. **`tryEmit` 总丢。** `extra` 为 0 且没人收？加大 extra 或挂起 `emit`。
4. **StateFlow 改了 UI 不动。** 引用没变、`equals` 仍相同？
5. **和冷流两次 collect 打两次网混谈。** 冷热边界在 `kp-coroutine-flow`；本篇是热流怎么持有历史/当前值。
