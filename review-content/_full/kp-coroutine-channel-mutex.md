---
id: kp-coroutine-channel-mutex
type: knowledge
module: coroutine
title: Channel、Mutex 与限流
priority: P0
version: 1
---

## 一句话

`Channel` 是协程之间会挂起的队列，`Mutex` 是会挂起的锁而且不可重入，`Semaphore` 用来限制同时进入的协程数；三者都不阻塞线程，也都不因 `delay` 而自动放开已经拿到的锁或许可。

## 组成与结构

Channel 容量：

| 容量 | 行为 |
|------|------|
| `RENDEZVOUS`（0，默认） | 无缓冲，send 和 receive 必须碰面 |
| 正整数 | 有界缓冲，满则 send 挂起 |
| `UNLIMITED` | 先堆着，内存会涨 |
| `CONFLATED` | 只留最新一条，发送方不挂起 |
| `BUFFERED` | 默认缓冲大小 |

`send` 在需要等待时挂起，`receive` 在空时挂起。`close()` 之后再收，会把缓冲吐完再结束 `for (x in channel)`。关闭后再 send 会失败。

`Mutex.withLock` 抢不到就挂起当前协程，拿到后执行块，块结束或抛异常都解锁。它不记录重入次数。`Semaphore(n)` 有 n 个许可，`withPermit` 取一个，没有就挂起。

和 Java 的对应：阻塞队列像 Channel，但等待堵的是线程；`synchronized` 像 Mutex，但是可重入且堵线程。

## 原理

1. **会合。** 容量为 0 时，发送方挂起直到有人 `receive`，数据直接交到对方手里，中间不存。这用来做「握手」或严格的一步一交付。容量大于 0 才是邮箱。`UNLIMITED` 没有背压，生产者比消费者快时，元素和续体把内存堆高，和线程池的无界队列是同一类坑。
2. **多个生产者、一个消费者。** 信令、写日志、按序改连接状态，适合多个协程 `send`，一个协程 `for (signal in channel)` 顺序处理。顺序性来自这一个消费者，不是 Channel 把所有协程变成单线程。消费者自己再 `launch` 出去，顺序就没了。
3. **Mutex 不可重入。** 同一协程 `withLock` 里面再 `withLock` 同一把，第二次挂起，等的解锁发生在外层块结束，而外层块要等内层返回，于是自己等自己。`synchronized` 同一线程可以重入，这是两边最重要的差别。嵌套调用要改成「锁只在最外层」或拆成不持锁的私有函数。
4. **持锁挂起不放锁。** `withLock` 里的 `delay`、`withContext` 会让出线程，但 Mutex 的持有者仍是这个协程。别的协程在 `withLock` 外挂起等待。所以锁里只放读改写共享变量的几行。更长的 IO 放锁外，必要时用「锁内拷贝快照，锁外处理，锁内提交」避免把临界区拉长。
5. **和 Dispatcher 的死锁环。** 持着 Mutex 切到 IO，IO 里又要等主线程上一个需要这把锁的协程，主线程那个协程正在等你解锁。挂起没有拆开这个环。固定多把锁的获取顺序，和 Java 死锁同一规则。
6. **Semaphore 限流。** 许可被取走后，第 n+1 个协程挂在 `withPermit`，不会再占一条新线程去堵。它不保证公平到严格先来后到的面试细节可以不展开，但要说明：限的是协程进入数，不是线程池大小。`Dispatchers.IO.limitedParallelism(3)` 是另一条路，限制这个视图上同时运行的协程。Channel 加固定个数的 worker 则是「队列 + 消费者数量」限流，还能天然背压。

`select` 可以同时等多个 Channel 或超时，知道能用来做「谁先来处理谁」即可。

## 使用与实践

任务队列、会话内串行发送用有界 Channel。UI 状态不要用 Channel 代替 `StateFlow`，Channel 的每个元素默认只被一个消费者收下，不适合多个界面订阅。

共享计数、连接状态用 Mutex 包住那一个可变对象，或者直接用单线程 Dispatcher 消灭锁。不要在 Mutex 里调用外部回调，回调可能再来要这把锁。

下载、上传并发用 `Semaphore(3)`。许可要用 `withPermit`，不要 `acquire` 之后在异常路径忘了 `release`。

Java 阻塞队列已经存在时，不必为了形式再包一层 Channel。不要在主线程上 `take()`。协程侧用 `send`/`receive` 才能在等待时让出主线程。

## 例子

```kotlin
val signal = Channel<Signal>(capacity = 64)

fun start(scope: CoroutineScope) = scope.launch {
    for (s in signal) handle(s) // 单消费者，保证顺序
}

suspend fun emit(s: Signal) { signal.send(s) }

val mutex = Mutex()
private var seq = 0

suspend fun next(): Int = mutex.withLock { ++seq }

val gate = Semaphore(3)
fun downloadAll(scope: CoroutineScope, ids: List<Int>) {
    ids.forEach { id ->
        scope.launch {
            gate.withPermit { download(id) }
        }
    }
}
```

错误的重入：

```kotlin
suspend fun outer() {
    mutex.withLock { inner() }
}
suspend fun inner() {
    mutex.withLock { println("到不了") } // 同一把，不可重入
}
```

`CONFLATED` 适合只保留最后一次进度：`Channel<Int>(Channel.CONFLATED)`。中间进度可以丢时才用，信令不能用它。

## 画面

```text
生产者 send --有界 Channel--> 一个消费者 for 循环
  满了：生产者挂起（背压）
  空了：消费者挂起

Mutex：协程 A 持有
  协程 B withLock -> 挂起，不堵线程
  A 的 withLock 结束才解锁
  A 自己再锁一次 -> 自己等自己

Semaphore(3)：第四个协程挂在 withPermit
```

## 常见坑与追问

1. **用无界 Channel 当邮件队列。** 追问：和线程池无界队列像在哪？生产者不停，内存涨，消费者看起来还在跑。用有界容量。
2. **Mutex 当 synchronized 那样嵌套。** 追问：为什么死锁？不可重入，第二次挂起等不到自己的解锁。
3. **withLock 里 withContext 做网络。** 追问：锁放开了吗？没有。临界区只留改状态的几行。
4. **多个收集者抢同一个 Channel 当事件总线。** 追问：一条消息谁收到？一个接收者。广播用 SharedFlow。
