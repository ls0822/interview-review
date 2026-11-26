---
id: kp-synchronized-lock
type: knowledge
module: concurrent
title: synchronized 与 ReentrantLock
priority: P0
version: 1
---

## 一句话

`synchronized` 锁的是对象监视器，可重入、出锁后建立可见性；`ReentrantLock` 是同一类互斥，但能超时、可中断、可公平、能挂多个条件队列。

## 组成与结构

两把锁都解决同一件事：同一时刻只有一个线程执行临界区，并且临界区里的写对下一个拿到锁的线程可见。差别在 API 和实现手柄。

`synchronized` 可以写在实例方法（锁 `this`）、静态方法（锁 `Class` 对象）、或任意 `synchronized (obj)` 块。锁的是对象，不是某段源码文字。两段代码同步块写得一模一样，只要锁的不是同一对象，就互不排斥。

`ReentrantLock` 是 `java.util.concurrent.locks` 里的显式锁，内部用 AQS（`AbstractQueuedSynchronizer`）维护一个 `state` 计数和等待队列。`state == 0` 表示没人持有；同一线程每重入一次 `state++`，`unlock` 减到 0 才真正释放并唤醒后继。

配套结构：

| 能力 | synchronized | ReentrantLock |
|------|----------------|---------------|
| 释放 | 出块自动放 | 必须 `finally` 里 `unlock` |
| 重入 | 计数，可重入 | 计数，可重入 |
| 超时 / 试锁 | 没有 | `tryLock`、`tryLock(time)` |
| 等待可中断 | 只有 `wait` 可中断 | `lockInterruptibly` |
| 公平 | 非公平 | 构造参数 `true` 才公平 |
| 多条件 | 一个等待集 | 多个 `Condition` |
| 实现层次 | 偏向 → 轻量 → 重量 | AQS + CAS，竞争激烈时也 park |

## 原理

按「怎么拿到、怎么重入、怎么升级、公平与否」四步讲。

1. **进入监视器。** 线程执行 `monitorenter`（或方法上的等价标志）。若监视器空闲，把锁记录到当前线程并计数置 1。若已经是自己持有，计数加 1，这就是可重入：同一线程内同步方法互相调用不会把自己卡死。其他线程进不来。
2. **退出。** `monitorexit` 计数减到 0 才真正释放。JVM 保证即使临界区抛异常，也会配对退出。释放这个动作和后续线程的获取构成 happens-before：锁里写过的共享变量，下一个加到同一把锁的线程一定看得到。
3. **锁升级（面试知道路径即可）。** HotSpot 历史上先尝试偏向锁（同一线程反复进，几乎只改 Mark Word），再升级为轻量级锁（CAS 把 Mark Word 指向栈上 Lock Record，适合短暂无竞争或交替竞争），CAS 失败且有人在等则膨胀成重量级锁，线程挂到操作系统监视器上。Java 15 起偏向锁默认关闭，新版本面试补一句「偏向锁已默认禁用，仍要会讲轻量到重量」。Android ART 的锁实现不等于 HotSpot，但「先自旋再阻塞」的方向可以类比，不要把 Mark Word 位图背到 ART 上。
4. **AQS 获取。** `ReentrantLock.lock()` 先 CAS 把 `state` 从 0 改成 1。失败则看是不是当前持有者，是就重入加计数；不是就把自己包成节点排进 CLH 变体队列，再 `park`。`unlock` 把计数减到 0 后 `unpark` 后继。公平模式：即使 `state` 此刻是 0，也要先看队列里有没有前驱，有则排队，禁止插队。非公平模式：新来的线程允许「barge」，锁刚释放时直接 CAS，成功就不用唤醒队头。吞吐通常更好，因为少一次挂起和上下文切换；代价是队头可能饿一会儿。

`Condition.await()` 必须先持有这把 `ReentrantLock`。它原子地放开锁并把线程放进该条件的等待队列，被 `signal` 后重新去抢锁，抢到才从 `await` 返回。这和 `Object.wait` 同构，只是等候室可以有多间：一个锁既能等「队列不空」又能等「队列不满」。

## 使用与实践

临界区只包住读改写共享状态的那几行。把网络、磁盘、`sleep` 放进 `synchronized` 会占着锁和线程。协程里更不要在 `synchronized` 块中调用挂起函数：监视器绑的是线程，挂起后恢复可能换线程，锁还在旧线程上，编译器也会直接禁止这种写法。

选锁：

- 简单互斥、希望自动释放：`synchronized`。
- 需要「拿不到就算了」或超时，避免死等：`tryLock`。
- 一个锁要精确唤醒「生产者」或「消费者」其中一侧：`Condition`，不要 `notifyAll` 把两边全叫醒再自己滤。
- 读多写少且读可以脏一点：不要用这两把互斥硬扛，考虑 `StampedLock` 乐观读或并发容器。面试点到即可。

SDK 对外的同步方法要写明「在哪条线程调用、会不会阻塞」。主线程上拿一把可能被 IO 线程长时间占用的锁，是 ANR 的经典栈：`monitor contention`。

## 例子

```java
final ReentrantLock lock = new ReentrantLock(); // 非公平
final Condition notEmpty = lock.newCondition();
final Queue<String> q = new ArrayDeque<>();

void produce(String item) throws InterruptedException {
    lock.lock();
    try {
        q.add(item);
        notEmpty.signal(); // 只叫醒等数据的消费者
    } finally {
        lock.unlock();
    }
}

String consume() throws InterruptedException {
    lock.lockInterruptibly();
    try {
        while (q.isEmpty()) notEmpty.await(); // 假醒用 while
        return q.remove();
    } finally {
        lock.unlock();
    }
}
```

公平锁写成 `new ReentrantLock(true)`。账户转账若要避免死锁，两把锁按账户 id 排序再依次 `tryLock`，失败则把已经拿到的释放掉再重试，而不是嵌套死等。

## 画面

```text
线程 T1                监视器 / AQS state          线程 T2
  |-- lock 成功 ------->  state=1, owner=T1
  |   临界区写 x
  |-- unlock ---------->  state=0  建立 hb
                         唤醒或被插队 CAS
T2 lock 成功 <----------  state=1, owner=T2
T2 读到 T1 写过的 x
```

## 常见坑与追问

1. **锁错对象。** `synchronized (new Object())` 每次新对象，等于没锁。追问：私有锁对象为什么比锁 `this` 好？因为外部无法随便 `synchronized(你的实例)` 和你抢同一把锁。
2. **忘了 unlock 或没放 finally。** 异常路径把锁留在当前线程，别人永远进不来。追问：`synchronized` 为什么没这个问题？编译器在出口和异常边都补了 `monitorexit`。
3. **非公平被说成「完全随机」。** 非公平只是允许在释放瞬间插队，不是不排队。追问：公平锁为什么吞吐差？因为即使锁空闲也要先看队列，多一次挂起唤醒。
4. **把可重入当成「同一把锁可以跨线程重入」。** 重入只认持有者线程。协程 `Mutex` 连同一协程都不许重入，这是下一题的分界，不要混。
