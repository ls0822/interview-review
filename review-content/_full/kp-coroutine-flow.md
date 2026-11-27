---
id: kp-coroutine-flow
type: knowledge
module: coroutine
title: Flow 冷流与热流
priority: P0
version: 5
order: 80
requires: [kp-coroutine-builders, kp-coroutine-channel-mutex]
---

## 一句话

`flow { }` 是**冷流**：有人 `collect` 才生产，每人通常各跑一遍上游。  
**热流**是已经在进行的数据源（典型由 `stateIn` / `shareIn` 或 `StateFlow`/`SharedFlow` 提供）——没人 collect 也可以有人在发；多人共享同一份上游。

StateFlow / SharedFlow / `replay` 的细则见下一篇 `kp-coroutine-state-shared-flow`，本篇只把冷热边界讲清。

## 组成与结构

| | 冷流 | 热流 |
|--|------|------|
| 何时生产 | `collect` 时跑上游 | 可不依赖某次 collect |
| 多收集者 | 常各跑一遍上游 | 共享同一份上游 |
| 类比 | 点播 | 直播 |
| 本篇代表 | `flow { }`、`flowOf` | `stateIn` / `shareIn` 之后 |

**关系一句：** 冷流是配方；用 Scope 跑成热流后，上游寿命跟 Scope，不跟某个界面。

先修：`kp-coroutine-builders`。热流三件套：`kp-coroutine-state-shared-flow`。背压与 Android 收集：`kp-flow-backpressure-android`。

## 原理

### 1. 冷流：每次 collect 执行整块上游

**是什么：** `flow { emit(api()) }` 被收集两次就请求两次。没人 `collect`，块里一行不跑。

**看代码：**

```kotlin
val cold = flow { emit(repo.load()) }
cold.collect { } // 请求 1
cold.collect { } // 请求 2
```

**和谁有关：** 要共享上游 → 单元 4 的 `shareIn`/`stateIn`，或直接用热流篇。

**别混：** 上游抛异常只影响**这次**收集；下次重新 `collect` 可再跑。

### 2. `flowOn` 只改它上面的上游

**是什么：** `flowOn(Dispatcher)` 之上的生产切到该调度器；**下面的 `collect` 仍在收集者协程上**。

**看代码：**

```kotlin
flow { emit(readDisk()) }
    .flowOn(Dispatchers.IO)
    .collect { updateUi(it) } // collect 仍在 Main（若在 viewModelScope）
```

**和谁有关：** 与 `buffer` 搭配见 `kp-flow-backpressure-android`。

**别混：** `flowOn` 不是 `withContext` 别名；不能指望它把收集者切到 IO。

### 3. Flow 上下文不变量

**是什么：** 同一次 `collect` 里，`emit` 不能并发、不能随便 `launch { emit }`。

**看代码：**

```kotlin
// 错
flow { launch { emit(42) } }.collect { }
// 对：多源用 channelFlow / callbackFlow
```

**和谁有关：** 多次回调桥见 `kp-callback-to-suspend`。

**别混：** `flowOn` 是官方允许的换上下文——整段上游挪到另一协程，不是并发 emit。

### 4. 冷流转热：`stateIn` / `shareIn`

**是什么：** 必须带 Scope；背后有协程跑上游。`WhileSubscribed(5_000)`：最后订阅者离开后再等 5 秒停上游，避免旋转掐请求。

**看代码：**

```kotlin
cold.stateIn(scope, SharingStarted.WhileSubscribed(5_000), initial)
```

**和谁有关：** 转成热流之后怎么用 `StateFlow`/`SharedFlow`、初值与 replay，见 `kp-coroutine-state-shared-flow`。`SharingStarted` 三种寿命见 `kp-flow-backpressure-android`。

**别混：** `shareIn` 后上游只跑一份；每个收集者仍各自 `collect` **热流**，不是冷流「每人重跑」。

## 使用与实践

### 什么时候留冷流，什么时候转热

**是什么：** 只要「这一次界面收集」→ 冷流 + 生命周期收集即可。要「多处订阅 / 旋转后还要当前值 / 省重复请求」→ `stateIn`/`shareIn` 或 Mutable 热流。

**看代码：**

```kotlin
// 单页一次性拉取：冷流够用
viewModelScope.launch {
    repo.flow().collect { _ui.value = it }
}

// 多订阅 / 配置变更后还要当前页状态：转热
val ui = repo.flow()
    .catch { emit(UiState.Error(it)) }
    .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), Loading)
```

**和谁有关：** 界面状态字段怎么建模见热流篇；`flatMapLatest` 搜索链见 `kp-flow-backpressure-android`。

**别混：** 不是「凡是 Flow 都要 stateIn」；没共享需求就别升热，省一个常驻协程。

### 异常要接在转热之前

**是什么：** `stateIn`/`shareIn` 前必须有 `catch`（或上游自己收成成功态），否则共享协程死掉，热流停在最后值。

**看代码：**

```kotlin
raw.catch { emit(UiState.Error(it)) }
    .stateIn(scope, SharingStarted.WhileSubscribed(5_000), Loading)
```

**和谁有关：** 未捕获与 Scope 见 `kp-coroutine-context`。

**别混：** `catch` 接不住 `collect` 块里自己抛的；也不吞 `CancellationException`。

## 例子

**错：** 同一冷流在两个界面各 `collect`，却以为只会打一次网。  
**对：** 要共享用 `shareIn`/`stateIn`；要隔离失败就继续各 collect 冷流。

**错：** `flowOn(IO)` 写在链尾，以为 `collect` 也在 IO。  
**对：** `flowOn` 只挪它上面的上游；`collect` 看你在哪个协程里调用。

## 画面

```text
冷流（配方）
  collect① → 上游跑一遍
  collect② → 上游再跑一遍

stateIn / shareIn（升热）
  Scope 里跑一份上游
  多个 collect → 共享这一份
  细节（当前值 / replay）→ 热流篇
```

## 常见坑与追问

1. **两次 collect 打两次网。** 冷流定义；要共享用 `shareIn`/`stateIn`。
2. **`flowOn` 放 collect 后指望切收集线程。** 只管上游。
3. **`stateIn` 上游异常未 catch。** 共享协程结束，值卡住。
4. **所有 Flow 都 stateIn。** 无共享需求不必升热。
