---
id: kp-coroutine-context
type: knowledge
module: coroutine
title: CoroutineContext 元素与异常处理器
priority: P0
version: 5
order: 30
requires: [kp-coroutine-basics]
---

## 一句话

把协程想成一张**工单**：工单上贴着几张便签（在哪跑、跟谁成父子、叫什么名、没人接的异常谁收）。  
`CoroutineContext` 就是这叠便签；`+` 是合并便签；**同一类便签后贴的盖掉先贴的**。  
`CoroutineExceptionHandler` 不是 try/catch——它只在「工单已经挂掉、且没人接手」时可能响一声。

## 组成与结构

| 便签（元素） | 管什么 | 不管什么 |
|--------------|--------|----------|
| `Job` | 父子、取消、活没活着 | 在哪条线程跑 |
| `Dispatcher` | 恢复时跑哪类线程 | 异常算不算被接住 |
| `CoroutineName` | 调试时叫什么 | 调度和异常 |
| `CoroutineExceptionHandler` | 未捕获异常最后上报 | 救活协程、接住取消 |

**关系一句：** 子协程会继承父的便签，但 **Job 一定换成自己的新工单**；父亲靠 `job.parent` 连着，不靠「上下文里还挂着父 Job 对象」。

先修：`kp-coroutine-basics`（挂起/续体）。调度细节：`kp-coroutine-dispatchers`。取消与监督：`kp-coroutine-cancel`。

## 原理

读法：每个小标题是一个独立点——**是什么 → 看代码 → 和谁有关 → 别混**。

### 1. 上下文是「按钥匙放的背包」

**是什么：** 每张便签有一把 Key（钥匙）。背包里**同钥匙只能留一件**。合并时用 `+`，得到新背包，旧的不变。

**看代码：**

```kotlin
val a = Dispatchers.Main + CoroutineName("ui")
val b = a + Dispatchers.IO
// b 里调度器只剩 IO，Main 被盖掉
// 名字还在，因为钥匙不同
```

**和谁有关：** 启动时的 `launch(Dispatchers.IO + …)` 就是在父背包上再盖几张便签。见 `kp-coroutine-builders`。

**别混：** `+` 不是「两个协程并排跑」，只是**合并配置**。

### 2. 子协程如何拿到自己的背包

**是什么：** 启动子协程时大约三步——先父背包 `+` 你传入的；若还没有调度器就补 `Default`；再**新建子 Job** 盖掉背包里的 Job。所以协程体内读到的 Job **永远是自己**。

**看代码：**

```kotlin
viewModelScope.launch(Dispatchers.IO) {
    val job = coroutineContext[Job]   // 自己的 Job
    // job.parent 才指向 Scope 那条父子链
}
```

**和谁有关：** `viewModelScope` 自带 `SupervisorJob + Main.immediate`，见本篇后文与 `kp-coroutine-cancel`。

**别混：** `CoroutineScope` 只是「持有一个上下文」的门面，用来 `launch`；它**不等于**上下文本身。

### 3. `launch(Job())` 为什么会「断亲」

**是什么：** 你传入的 `Job()` 会成为**新子 Job 的父亲**，而不是「子协程自己」。于是 Scope 取消传不到这张新工单——结构化并发从这里断开。

**看代码：**

```kotlin
viewModelScope.launch(Job()) { // 危险：换父了
    // 页面销毁时，这条不一定跟着停
}
viewModelScope.launch(Dispatchers.IO) { // 只换线程，父亲仍是 Scope
}
```

**和谁有关：** 和 `GlobalScope` 同类问题：活着但没人管。取消语义见 `kp-coroutine-cancel`。

**别混：** `SupervisorJob()` 当 **launch 参数** = 换父；`supervisorScope { }` = 自己仍是孩子，只是**不把孩子失败传给兄弟**。两句话不要揉成一句。

### 4. 异常处理器什么时候才会响

**是什么：** CEH 看的是「还有没有人接」，不是「背包里有没有这张便签」。普通父 Job 会接手孩子失败 → 子 CEH **不调用**。父是 Supervisor（或不接手）且没人 catch → 才可能进 CEH。

**看代码：**

```kotlin
val handler = CoroutineExceptionHandler { _, e -> log(e) }

viewModelScope.launch {
    launch(handler) { throw RuntimeException("a") }
    // 父是 Supervisor：handler 通常会收到

    coroutineScope {
        launch(handler) { throw RuntimeException("b") }
        // 父是普通 Job：父接手，这个 handler 不响
    }
}
```

**和谁有关：** `async` 把异常放进 `Deferred`，CEH 基本无效，要 `await`；见 `kp-coroutine-builders`、`kp-coroutine-cancel`。

**别混：** CEH **不是** try/catch。catch 还能让协程继续；CEH 响的时候协程**已经结束**，只能记日志，不能当重试现场。

### 5. try/catch 要包「会抛回来的那一行」

**是什么：** `launch { }` 那一行立刻返回 Job，异常在以后才抛。包住 `launch(...)` 没用；要包块内部，或包 `withContext` / `coroutineScope` / `await`。

**看代码：**

```kotlin
try {
    launch { throw RuntimeException("晚了") } // catch 不到
} catch (_: Throwable) { }

launch {
    try {
        withContext(Dispatchers.IO) { error("能接到") }
    } catch (e: Throwable) {
        showError(e)
    }
}
```

**和谁有关：** 结构化失败出口优先 `coroutineScope` 把异常抛回调用方，而不是依赖根上 CEH。

**别混：** `CancellationException`（含超时取消）不当业务失败，CEH 故意忽略；超时要在 `withTimeout` 外单独处理。

### 6. Android 上为什么特别容易踩坑

**是什么：** `viewModelScope` = `SupervisorJob + Main.immediate`。兄弟互不拆；但也因此，子 `launch` 没 catch、Scope 又没 CEH 时，未捕获常直接崩。

**看代码：**

```kotlin
viewModelScope.launch {
    // 没 catch：失败往往变未捕获（监督父不接手）
    repo.load()
}
viewModelScope.launch {
    runCatching { repo.load() }
        .onFailure { ui.error = it.message }
}
```

**和谁有关：** 界面错误态应写成 `UiState`/`Result`，见 `kp-coroutine-flow`、`kp-flow-backpressure-android`。

**别混：** `Main.immediate` 只影响「要不要立刻在当前主线程跑」，**不是** Job，也不隔离异常。

## 使用与实践

### 组装业务 Scope 时写清三样

**是什么：** 父 Job（谁 `cancel`）、默认线程、要不要只打日志的 CEH。

**看代码：**

```kotlin
val appScope = CoroutineScope(
    SupervisorJob() +
        Dispatchers.Main.immediate +
        CoroutineName("app") +
        CoroutineExceptionHandler { _, e -> log(e) }
)
// 不用时：appScope.cancel()
```

**和谁有关：** 页面级优先用现成 `viewModelScope`，不要再套一层没人取消的 Scope。

**别混：** CEH 里不要更新 UI、不要清状态——工单已经死了。

### 并行请求：先决定要不要互相取消

**是什么：** 要「一个失败全停」用 `coroutineScope`；要「各管各的」用 `supervisorScope`，且各自接异常。

**看代码：**

```kotlin
suspend fun loadBoth() = coroutineScope {
    val a = async { repo.a() }
    val b = async { repo.b() }
    a.await() to b.await() // 一边挂，另一边会被取消
}

suspend fun loadLoose() = supervisorScope {
    val a = async { runCatching { repo.a() } }
    val b = async { runCatching { repo.b() } }
    a.await() to b.await()
}
```

**和谁有关：** `async`/`await` 细节见 `kp-coroutine-builders`。

**别混：** 只换 `supervisorScope` 却不 `await`、不处理失败，异常仍可能变未捕获。

## 例子

把「只换线程」和「换父」放一起对照：

```kotlin
val parent = SupervisorJob()
val base = parent + Dispatchers.Main.immediate + CoroutineName("vm")

val onlyIo = base + Dispatchers.IO
// Job 仍是 parent；只是工人换成 IO

val orphan = base + Job() + Dispatchers.IO
// Job 换成新的；parent 取消管不到 orphan 这条链
```

**错：** 以为「包了 launch 的 try/catch」就能接到子协程异常。  
**对：** catch 写进协程体，或包住 `await` / `withContext` / `coroutineScope`。

## 画面

```text
背包 = CoroutineContext
  [Job] [Dispatcher] [Name] [CEH?]
         +
  后写同 Key → 盖掉先写

launch 时：
  父背包 + 传入  → 缺调度器补 Default → 新建子 Job 盖上
                      │
                      ▼
              协程体内读到的 Job = 自己

异常：
  普通父接手？──是──▶ 子 CEH 不响（父失败/取消兄弟）
       │
       否（Supervisor / 根）
       ▼
  launch → CEH 或平台默认（Android 常崩）
  async  → 进 Deferred，等 await；CEH 基本不响
```

## 常见坑与追问

1. **每个 launch 都加了 CEH，有的不打印。** 先问父是谁。普通 `coroutineScope` 孩子把异常交给父，子 CEH 跳过。
2. **try 包住 launch。** 那一行已经返回了；异常在以后。
3. **async 会进 CEH。** 不会；异常在 `Deferred` 里。
4. **SupervisorJob 和 supervisorScope 当成同一句。** 参数换父 vs 作用域内监督孩子，取消路径不同。
5. **handler 里当着重试现场。** 旧 Job 已失败结束；重试是新启动。
6. **有 CoroutineName 就固定线程。** 名字不调度；线程只看 Dispatcher。
