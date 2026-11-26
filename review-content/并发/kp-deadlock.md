---
id: kp-deadlock
type: knowledge
module: concurrent
title: 死锁条件与排查
priority: P0
version: 1
---

## 一句话

死锁是一组线程或协程循环等对方手里的锁；四个条件同时成立才会发生，工程上最常打破的是「循环等待」——全局规定同一把加锁顺序。

## 组成与结构

四个条件缺一不可：

| 条件 | 含义 | 锁场景里的样子 |
|------|------|----------------|
| 互斥 | 资源一次只给一个持有者 | 监视器、`ReentrantLock`、`Mutex` |
| 占有且等待 | 拿着 A 还去等 B | 嵌套加锁 |
| 不可剥夺 | 别人不能把你的锁抢走 | 普通锁都不能抢 |
| 循环等待 | 存在等待环 | A 等 B 的锁，B 等 A 的锁 |

破坏任意一条就能避免。互斥通常不能破坏，否则临界区没意义。不可剥夺对普通锁也不现实。`tryLock` 超时是在「占有且等待」上让步：等不到就把已经拿到的放下。固定顺序是在破坏循环等待，最常用。

Kotlin 还有 Java 同步里没有的一种环：`Mutex` 不可重入，同一协程在 `withLock` 里再锁同一把 `Mutex`，自己等自己。`synchronized` 同一线程重入不会这样。

活锁是大家都退让又都重试，系统没停但没进展。饥饿是公平性出了问题，某个线程一直抢不到。面试先讲死锁，再补这两个词，避免混成一个。

## 原理

1. **环怎么形成。** 线程 1 已持有 lockA，线程 2 已持有 lockB。线程 1 去要 lockB，进入等待；线程 2 去要 lockA，也进入等待。两边的等待条件都只能由对方释放来满足，而对方要先获得自己手里的锁才能释放，于是谁也走不到释放那一行。`sleep` 或 `delay` 只是把窗口拉大，不是死锁的原因。
2. **为什么顺序能拆环。** 规定任何线程都先锁 id 较小的账户，再锁 id 较大的。那么「持有大 id、等待小 id」这条边不会出现，图里就没有环。两把锁时写成「总是先 A 后 B」即可。动态多把锁时先排序再依次获取。
3. **tryLock 的退让。** 按顺序 `tryLock`，第二把失败就把第一把 `unlock`，随机或指数退避后再来。这样不会无限占有且等待。代价是业务要能重试，不能在持有第一把锁时已经做了不可回滚的副作用。
4. **协程里的两种死锁。** 两把 `Mutex` 顺序相反，和线程相同；`withLock` 里 `delay` 不会放锁，窗口更大。同一把 `Mutex` 嵌套，等待者就是持有者，环的长度是 1。另外一种隐蔽环：持着 `Mutex` 切到 `Dispatchers.IO`，IO 里又要等主线程上一个需要这把锁的协程，而主线程那个协程正在等你放锁。挂起没有把锁交出去。
5. **排查看栈，不靠猜。** Android ANR traces 或 `jstack` 里，线程停在 `BLOCKED`（monitor）或 `WAITING`（`ReentrantLock` / `park`）。两边的栈顶互相指向对方持有的锁对象地址，就能对上环。`Mutex` 没有 JVM 监视器，栈会停在 `kotlinx.coroutines` 的挂起点，要结合「谁拿着锁」的日志或调试器，不能只搜 `monitor contention`。

数据库事务锁、Binder 调用对方进程又被对方回调回来，也是环，只是资源不叫 Java 锁。口述时把「循环等待」抽出来，面试官知道你不是只会背四个名词。

## 使用与实践

锁的粒度小、持有时间短、不要在持锁时调用外部回调（回调可能再来抢锁）。能用并发队列把所有权交出去，就不要多线程共享可变对象。

协程优先把状态收进单线程调度器（同一个 `limitedParallelism(1)` 或单线程池转的 Dispatcher），从结构上消灭锁。必须用 `Mutex` 时，锁的范围只包住改字段的几行，不要包住 `withContext`、网络和 `delay`。

线上若已经死锁，重启只能清现场。下次要留下：线程名、持有的锁 id、等待的锁 id。没有这些，traces 里只有匿名 `pool-1-thread-3`。

## 例子

```java
void transfer(Account a, Account b, int n) {
    Account first = a.id < b.id ? a : b;
    Account second = a.id < b.id ? b : a;
    synchronized (first) {
        synchronized (second) {
            if (a.balance < n) return;
            a.balance -= n;
            b.balance += n;
        }
    }
}
```

Kotlin 不可重入：

```kotlin
val mutex = Mutex()
suspend fun outer() {
    mutex.withLock {
        inner() // 若 inner 再 withLock 同一把，永远等自己
    }
}
```

两把锁的错误顺序不必再抄一遍：协程 1 `lockA` 后 `delay` 再要 `lockB`，协程 2 相反。`delay` 让出的是线程，不是 `lockA`。

## 画面

```text
线程1 持有 A ----等待----> 锁 B 被线程2 持有
   ^                         |
   |                         v
锁 A 被线程1 持有 <----等待---- 线程2 持有 B

拆环：所有人都先 A 后 B，第二条边消失
```

## 常见坑与追问

1. **只背四条件，写不出例子。** 追问：拿掉「不可剥夺」为什么日常做不到？因为 `synchronized` 没有抢锁 API。能做的是 `tryLock` 自己放下。
2. **以为协程挂起会放 Mutex。** 追问：和 `sleep` 在同步块里像在哪？都是占着锁等时间流逝，别人进不来。
3. **同一线程嵌套 synchronized 当成死锁。** 那是重入，计数加一。追问：为什么 Mutex 不算重入？它的实现不记「持有者协程再入一次」，第二次 `lock` 会挂起等一次还没发生的 `unlock`。
4. **主线程同步 Binder，对方进程又同步调回来。** 栈上不一定有两把 Java 锁，但循环等待在。追问：ANR 里怎么认？主线程停在 `BinderProxy.transact`，对端停在回你的进程。
