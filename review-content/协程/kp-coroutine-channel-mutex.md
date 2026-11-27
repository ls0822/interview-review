---
id: kp-coroutine-channel-mutex
type: knowledge
module: coroutine
title: Channel、Mutex 与限流
priority: P0
version: 4
order: 70
requires: [kp-coroutine-builders]
---

## 一句话

`Channel` 是协程之间**会挂起**的队列；`Mutex` 是**会挂起且不可重入**的锁；`Semaphore` 限制**同时进入**的协程数。三者都只挂起协程、不堵线程；持锁或持许可时 `delay`/`withContext` **不会**自动放开。

## 组成与结构

| 工具 | 管什么 | 不管什么 |
|------|--------|----------|
| `Channel` | 多协程交接数据、背压（有界时） | 广播给所有订阅者 |
| `Mutex` | 保护一个可变对象 | 重入、线程阻塞 |
| `Semaphore` | 限同时执行的协程数 | 公平排队细节、线程池大小 |

Channel 容量一眼表：

| 容量 | 行为 |
|------|------|
| `RENDEZVOUS`（0，默认） | 无缓冲，send 与 receive 必须碰面 |
| 正整数 | 有界缓冲，满则 send 挂起 |
| `UNLIMITED` | 先堆着，内存会涨 |
| `CONFLATED` | 只留最新，发送方不挂起 |
| `BUFFERED` | 平台默认缓冲档（常作 64） |

**关系一句：** Channel 解决「谁把东西交给谁」；Mutex 解决「同一时刻只有一个协程改这块状态」；Semaphore 解决「最多 N 个协程同时干这件事」——三者可组合，但不要互相替代。

先修：`kp-coroutine-builders`（挂起语义）。广播与界面状态：`kp-coroutine-flow`。调度与死锁：`kp-coroutine-dispatchers`。

## 原理

读法：**是什么 → 看代码 → 和谁有关 → 别混**。

### 1. 容量 0 的「会合」不是邮箱

**是什么：** `RENDEZVOUS` 时数据不经缓冲，发送方挂起直到有人 `receive`，直接交到对方手里。这是握手式交付，不是「先进邮箱再取」。

**看代码：**

```kotlin
val ch = Channel<Int>() // capacity 0
launch { ch.send(1) }   // 挂起，直到有人 receive
launch { println(ch.receive()) }
```

**和谁有关：** 有界正容量才是「邮箱 + 背压」；见后文 `UNLIMITED`。与 Flow 默认会合同族，见 `kp-flow-backpressure-android`。

**别混：** 会合不等于慢——只是**没有中间槽**，生产者必须等消费者接上。

### 2. 有界 Channel + 单消费者 = 顺序队列

**是什么：** 多个协程 `send`，**一个**协程 `for (x in channel)`，顺序由这一个消费者保证。消费者里再 `launch` 出去，顺序就没了。

**看代码：**

```kotlin
val signal = Channel<Signal>(64)
scope.launch {
    for (s in signal) handle(s) // 唯一消费者
}
suspend fun emit(s: Signal) { signal.send(s) }
```

**和谁有关：** 工作队列、会话内串行信令。与 `Channel` 当事件总线（多消费者）是反例，见单元 6。

**别混：** Channel **不**把全世界变成单线程；只是这条队列上的处理顺序固定。

### 3. Mutex 不可重入——和 synchronized 最大差别

**是什么：** 同一把 `Mutex`，同一协程 `withLock` 里再 `withLock`，第二次挂起等外层解锁；外层等内层，**自己等自己**。

**看代码：**

```kotlin
suspend fun outer() = mutex.withLock { inner() }
suspend fun inner() = mutex.withLock { println("到不了") }
```

**和谁有关：** 共享计数、连接状态保护。单线程 Dispatcher 可消灭锁，见 `kp-coroutine-dispatchers` 的 `limitedParallelism(1)`。

**别混：** Java `synchronized` **可重入**；嵌套要改成「锁只在最外层」或拆成不持锁的私有函数。

### 4. 持锁挂起：锁不随线程让出而释放

**是什么：** `withLock` 里的 `delay`、`withContext` 会让出**线程**，但 Mutex 持有者仍是这个协程，别的协程仍在 `withLock` 外排队。

**看代码：**

```kotlin
mutex.withLock {
    snapshot = state.copy()
}
process(snapshot) // 放锁外做 IO
mutex.withLock { state = result }
```

**和谁有关：** 与 Dispatcher 切换组合时的死锁环，见单元 5。

**别混：** 锁里只留读改写共享变量的几行；长 IO 放锁外，必要时快照进出。

### 5. Mutex + 错误 Dispatcher = 死锁环

**是什么：** 持锁切到 IO，IO 里又要等主线程上同样需要这把锁的协程，而主线程那个在等你解锁——挂起没有拆开这个环。

**看代码：**

```kotlin
// 危险形态：持锁 + 切线程 + 对端也要同一把锁
mutex.withLock {
    withContext(Dispatchers.Main) { /* 又要 mutex */ }
}
```

**和谁有关：** 与 Java 多锁顺序规则相同：固定获取顺序、缩小临界区。见 `kp-coroutine-cancel` 里取消与锁。

**别混：** 「协程不阻塞线程」≠ 锁里可以随便 `withContext` 网络请求。

### 6. Channel 不是广播总线

**是什么：** 默认每个元素**只被一个** `receive` 收走。两个 `for (e in ch)` 会**抢**消息，不是各收一份。

**看代码：**

```kotlin
val bus = Channel<Event>()
launch { for (e in bus) panelA.handle(e) }
launch { for (e in bus) panelB.handle(e) } // 每条只进一个 for
```

**和谁有关：** 多界面订阅用 `SharedFlow` / `StateFlow`，见 `kp-coroutine-flow`。

**别混：** `CONFLATED` 是「只留最新一条」，不是广播；信令不能用它当备份。

### 7. Semaphore 限的是协程，不是线程数

**是什么：** `Semaphore(n)` 有 n 个许可；第 n+1 个协程挂在 `withPermit`，不占新线程傻等。限的是**同时进入临界区的协程**。

**看代码：**

```kotlin
val gate = Semaphore(3)
ids.forEach { id ->
    scope.launch {
        gate.withPermit { download(id) }
    }
}
```

**和谁有关：** `Dispatchers.IO.limitedParallelism(3)` 限的是**该视图**上同时跑的协程；Channel + 固定 worker 数则是队列 + 消费者限流。见 `kp-coroutine-dispatchers`。

**别混：** 手动 `acquire()` 后异常路径忘了 `release()` → 许可泄漏，后续永远挂起；用 `withPermit`。

### 8. `select`：多路等待的原子选择

**是什么：** 同时等多个 Channel 或超时，**同一时刻只有一个分支**成功，避免手写两把锁竞态。

**看代码：**

```kotlin
select<Unit> {
    signal.onReceive { handle(it) }
    cmd.onReceive { dispatch(it) }
    onTimeout(5_000) { reconnect() }
}
```

**和谁有关：** 会话层「谁先到处理谁」。不是日常业务第一选择，但面试会问和手写 `receive` 的差别。

**别混：** 在 `select` **外**再分别 `receive` 两个 Channel，可能重复处理或漏窗口。

## 使用与实践

### Channel：队列 vs 界面状态

**是什么：** 任务队列、串行信令用**有界** Channel + 单消费者。UI 状态不要用 Channel 顶 `StateFlow`。

**看代码：**

```kotlin
val signal = Channel<Signal>(capacity = 64) // 有界，满则 send 挂起
// 进度只关心最后一次：Channel<Int>(Channel.CONFLATED)，中间可丢
```

**和谁有关：** `kp-coroutine-flow` 里冷热与 `StateFlow`。

**别混：** `UNLIMITED` 不是「不会丢」，是把背压变成内存；快生产仍会 OOM。

### Mutex：保护一个可变对象

**是什么：** 共享 `var`、连接状态用 `withLock` 包住那一个对象；或干脆单线程视图消灭锁。

**看代码：**

```kotlin
private var seq = 0
suspend fun next(): Int = mutex.withLock { ++seq }
```

**别混：** 不要在 Mutex 里调外部回调——回调可能再来要这把锁。

### Semaphore 与 Java 桥接

**是什么：** 下载/上传并发用 `Semaphore(k)`。已有 Java 阻塞队列时不必为形式再包 Channel。

**看代码：**

```kotlin
gate.withPermit { download() } // 不要 acquire 后裸奔
```

**别混：** 主线程上 `BlockingQueue.take()` 堵的是线程；协程侧用 `send`/`receive` 才能挂起让出。

## 例子

场景串：信令队列 + 限流下载 + 重入对照。

```kotlin
// 对：单消费者顺序处理
start(scope) { for (s in signal) handle(s) }

// 错：Mutex 当 synchronized 嵌套 → 单元 3
// 错：close 后继续 send → ClosedSendChannelException
channel.close(); channel.send(x)

// 错：Semaphore acquire 忘 release → 用 withPermit
```

**错：** 两个界面 `for` 同一个 Channel 当总线。  
**对：** 状态 `StateFlow`，事件 `SharedFlow(replay=0)`。

## 画面

```text
有界 Channel：send --[缓冲]--> 单个 for 消费者
  满了：send 挂起（背压）
  空了：receive 挂起

Mutex：协程 A 持有
  B 的 withLock → 挂起（不堵线程）
  A 结束块才解锁
  A 再锁同一把 → 自己等自己

Semaphore(3)：第 4 个挂在 withPermit
```

## 常见坑与追问

1. **无界 Channel 当邮件队列。** 追问：和线程池无界队列像在哪？生产者不停，内存涨。用有界容量。
2. **Mutex 当 synchronized 嵌套。** 追问：为什么死锁？不可重入，第二次挂起等不到自己的解锁。
3. **`withLock` 里 `withContext` 做网络。** 追问：锁放开了吗？没有；临界区只留改状态几行。
4. **两个收集者抢同一 Channel 当总线。** 追问：一条消息谁收到？一个接收者。广播用 `SharedFlow`。
5. **`select` 外手动锁两个 Channel。** 追问：竞态在哪？可能双就绪重复处理。用 `select` 原子等。
6. **`Channel.UNLIMITED` 当「不会丢」。** 追问：背压去哪了？堆内存和续体；快生产仍会 OOM。
