---
id: kp-coroutine-basics
type: knowledge
module: coroutine
title: 协程模型：线程、挂起与续体
priority: P0
version: 9
order: 10
---

## 一句话

协程是跑在线程上的**可挂起工单**：挂起时放下书签、让出工人；阻塞才是工人干等占线。恢复时按 `Dispatcher` 找哪类线程，**不保证还是原来那一条**。  
`suspend` 只声明「这段代码允许挂起**当前协程**」——**不**等于新开协程，也**不**等于自动换线程。

## 组成与结构

| 零件 | 干什么 | 不是什么 |
|------|--------|----------|
| 线程 | 真跑指令的工人（OS 调度） | 协程本身 |
| 协程 | 挂在工人身上的任务/工单 | 自带内核栈的轻量线程 |
| `Continuation` | 书签：下一步哪一行、跨挂起点要的局部变量 | 把线程冻住的机制 |
| 挂起点 | `delay` / `withContext` / `suspend` 函数 / `yield` / `await` | 普通同步代码 |

**关系一句：** 没工人协程不动；一次挂起把状态塞进续体、函数返回，工人立刻能干别的工单；就绪后调度器按 `Dispatcher` 挑线程，从书签继续。

先修无。后续：`kp-coroutine-dispatchers`（在哪跑）、`kp-coroutine-builders`（怎么起工单）、`kp-coroutine-context`（上下文便签）。

## 原理

读法：每个小标题是一个独立点——**是什么 → 看代码 → 和谁有关 → 别混**。

### 1. 挂起让出工人，阻塞占住工人

**是什么：** `delay` 登记定时，当前工单暂停，线程去干别的；到点再恢复。`Thread.sleep` 让这条线程进入等待，谁也用不了它。

**看代码：**

```kotlin
lifecycleScope.launch {
    delay(100)              // 挂起：主线程可去跑别的协程
    textView.text = "ok"
}
// Thread.sleep(100) 同样位置 → 主线程卡死，界面不动
```

**和谁有关：** 调度细节见 `kp-coroutine-dispatchers`；取消在挂起点检查见 `kp-coroutine-cancel`。

**别混：** 挂起 ≠ 阻塞。一百个等网络的**挂起**协程可以挤在少量线程上；一百个**阻塞**读往往要近一百条线程。

### 2. `suspend` 挂起的是「调用它的那条协程」

**是什么：** 挂起函数不是另有一条独立生命。`loadUser()` 里遇到真挂起点时，停的是外面那条 `launch`/`viewModelScope` 工单；`loadUser` 只是这条工单正在执行的一层。外面的下一行也会一起等这次调用返回。

**看代码：**

```kotlin
viewModelScope.launch {          // ① 只有这里才新开协程
    _ui.value = Loading
    val user = loadUser(id)      // ② 挂起时停的是上面这条协程
    _ui.value = Success(user)    // ③ 恢复后才会执行
}

suspend fun loadUser(id: String): User =
    withContext(Dispatchers.IO) { api.get(id) }  // 挂起点在这里
```

**和谁有关：** `withContext`/`launch` 谁才新开 Job，见 `kp-coroutine-builders`；状态机见 `kp-coroutine-internals`。

**别混：** `suspend` ≠ 一调用就异步并行。普通函数直接调 `suspend fun` 会编译失败——这是调用约定，不是「自动开线程」。

### 3. 纯计算的 `suspend`：往往一次也不挂起

**是什么：** 函数体若只有算术、拼字符串、同步解析，没有 `delay`/`withContext`/挂起 API，协程会**在当前线程一口气跑完**。标了 `suspend` 也不会变并行、不会自动去 IO。

**看代码：**

```kotlin
suspend fun score(list: List<Int>): Int {
    var s = 0
    for (x in list) s += x   // 无挂起点
    return s
}

viewModelScope.launch {
    val n = score(bigList)   // 若仍在 Main，就在主线程算完
}
```

**和谁有关：** 大计算应 `withContext(Dispatchers.Default)`，见 `kp-coroutine-dispatchers`。

**别混：** 「写了 suspend」≠「界面就不会卡」。卡不卡看有没有占住 Main，以及有没有真挂起让出。

### 4. 续体：编译器拆成状态机

**是什么：** 挂起函数被编译成带 `label` 的状态机。到挂起点把还要用的局部变量放进 `Continuation`，返回 `COROUTINE_SUSPENDED`；恢复时按 `label` 跳进后半段。

**看代码：**

```kotlin
suspend fun load(): String {
    val a = step1()           // label 0 → 1
    val b = withContext(Dispatchers.IO) { step2(a) }  // 挂起点
    return step3(b)           // 从 IO 回来后继续
}
// 背后：一个 Continuation 对象背着 a、当前走到第几步
```

**和谁有关：** 回调桥接仍靠 `resume` 填书签，见 `kp-callback-to-suspend`。

**别混：** 书签是**协程状态**，不是把操作系统线程挂起。

### 5. 恢复认 Dispatcher，不认线程编号

**是什么：** `withContext(Dispatchers.IO)` 块在 IO 池的某条线程跑；块结束回到**调用前**的 Dispatcher。从 Main 进来，下一行回 Main；IO 里具体哪一条**不保证不变**。

**看代码：**

```kotlin
lifecycleScope.launch { // Main.immediate
    val text = withContext(Dispatchers.IO) { readFile() }
    textView.text = text    // 回到 Main，不一定是刚才 IO 那条线程
}
```

**和谁有关：** `Dispatchers.Main` 只有一条主线程，回到 Main = 回到那一条。`Main.immediate` 见 `kp-coroutine-dispatchers`。

**别混：** 「在 IO 里跑过」≠「之后永远在 IO 线程」；认**上下文里的 Dispatcher**，不认 `Thread.currentThread().id`。

### 6. 同一线程上是协作式，不抢占

**是什么：** 同一工人同一时刻只干一张工单。没有挂起点就不会换单；两个 `launch` 都带 `delay`，常见先把挂起前的代码都跑完，再在 delay 之后交错。

**看代码：**

```kotlin
scope.launch { println("1-A"); delay(100); println("1-B") }
scope.launch { println("2-A"); delay(100); println("2-B") }
// 常见：1-A → 2-A → 1-B / 2-B

scope.launch { heavyCompute() }  // 无挂起点
scope.launch { println("2-A") } // 要等 heavyCompute 整段跑完
```

**和谁有关：** 真并行要多核 + 多条线程上的工单，或 `Dispatchers.Default` 上多个 worker。

**别混：** 协程同线程**不会**像两条内核线程那样被时间片抢占；饿死邻居是因为**没挂起点**。

### 7. `yield` 与 `ensureActive` 管两件事

**是什么：** `yield()` 挂一下，让同 Dispatcher 上别的协程有机会跑，也是取消检查点。`ensureActive()` **只查**自己是否该停，发现取消就抛 `CancellationException`，**不让**邻居。

**看代码：**

```kotlin
while (isActive) {
    heavyCpu()
    yield()           // 邻居被饿死 → 用这个
}

while (isActive) {
    ensureActive()    // 只怕取消来了还空转
    heavyCpu()
}
```

**和谁有关：** 取消语义见 `kp-coroutine-cancel`；占满 `Default` 全部 worker 还会饿别的计算，要限并行度。

**别混：** 邻居饿死用 `yield`；只防取消误用 `ensureActive`。常一起写，但**不是一个问题**。

### 8. 优势有边界

**是什么：** 等 IO 时少占线程、顺序写法、Scope 取消能一起停——真的。CPU 算力不会变多；多协程改同一变量仍要同步；`GlobalScope` 照样泄漏。

**看代码：**

```kotlin
// 主线程协程里直接阻塞读 → ANR，协程救不了
lifecycleScope.launch {
    File("/sdcard/big").readBytes()  // 同步阻塞，占 Main
}
// 应对：withContext(IO) 或挂起 API
```

**和谁有关：** 结构化并发见 `kp-coroutine-builders`。

**别混：** `launch { }` 块是挂起**环境**，块里写的普通 `fun` **不会**自动变成 `suspend`；要有挂起点才会让出线程。

## 使用与实践

### 按活选工人类型（Dispatcher）

**是什么：** 网络/磁盘/阻塞 SDK → 挂起 API 或 `withContext(Dispatchers.IO)`。纯计算 → `Dispatchers.Default`，紧循环里 `yield`/`ensureActive`。改界面 → 回到 Main。

**看代码：**

```kotlin
viewModelScope.launch {
    val raw = withContext(Dispatchers.IO) { api.fetch() }
    val parsed = withContext(Dispatchers.Default) { parse(raw) }
    _ui.value = parsed
}
```

**和谁有关：** `viewModelScope` 默认 `Main.immediate`，见 `kp-coroutine-dispatchers`。

**别混：** 不要用 `Thread.sleep` 代替 `delay`——会把池里工人睡死。

### 共享可变状态

**是什么：** 协程切换**不加锁**。多协程写同一变量用 `Mutex`，或收进单线程 `Dispatcher`。

**看代码：**

```kotlin
private val mutex = Mutex()
suspend fun bump() = mutex.withLock { counter++ }
```

**和谁有关：** Flow/State 单写端见 `kp-coroutine-flow`。

**别混：** 「协程轻量」≠「可以随便共享可变 without 同步」。

## 例子

主线程上两个带 `delay` 的 `launch`：先打完 `1-A`、`2-A`，再在约 100ms 后交错 `1-B`、`2-B`。把 `delay` 换成 `Thread.sleep`，第一次 sleep 主线程就停，`2-A` 和界面都动不了；换成不挂起的 `heavyCompute()`，`2-A` 要等计算结束。

**错：** `while (true) { heavyCpu() }` 在 `Default` 上无挂起点，占满一个 worker。  
**对：** `while (isActive) { heavyCpu(); yield() }`（或至少 `ensureActive()`）。

## 画面

![协程模型：线程工人与协程工单](./assets/diagrams/coroutine-model.svg?v=2)

```text
一条线程（工人）
  工单1 → delay → 书签放下，工人空出
  工单2 → delay → 书签放下
  到点 → 按 Dispatcher 找工人，翻开工单1 书签

无挂起点：工单1 一直占着，工单2 排队
```

## 常见坑与追问

1. **把挂起说成阻塞。** 追问：`delay` 时线程在干嘛？可以去跑别的协程，不是 `sleep` 占线。
2. **以为 `suspend fun` 自己冻住、外面 launch 还往下跑。** 不对：挂起的是整条调用它的协程。
3. **纯计算标了 suspend 就当异步。** 追问：有挂起点吗？没有就仍占当前线程。
4. **认为恢复还在 IO 同一条线程。** 追问：什么才固定？只有 Main 这类单线程 Dispatcher。
5. **同线程两个协程会像两线程抢占。** 追问：死循环？没挂起点不让出，加 `yield`/`ensureActive`。
6. **主线程阻塞 IO 还觉得协程能救 ANR。** 追问：谁占 Main？那个阻塞调用本身。
7. **以为 launch 块里调用的方法都变 suspend。** 不对：块提供挂起上下文，普通 `fun` 仍是同步跑完。