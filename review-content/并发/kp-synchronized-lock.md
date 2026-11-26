---
id: kp-synchronized-lock
type: knowledge
module: concurrent
title: synchronized 与 ReentrantLock
priority: P0
version: 2
requires: [kp-volatile-hb]
order: 30
---

## 一句话

`synchronized` 锁对象监视器，可重入，解锁 hb 后续加锁；`ReentrantLock` 同类互斥，但能超时、可中断、可选公平、可多 `Condition`——失败路径常是忘了放锁或锁错对象。

## 组成与结构

两者同时给：**互斥** + **可见性**（解锁 hb 下一次加锁）。差别在 API 与实现手柄。

| 能力 | synchronized | ReentrantLock |
|------|----------------|---------------|
| 释放 | 出块自动 | 必须 `finally` unlock |
| 重入 | 监视器计数 | AQS state 计数 |
| 超时/试锁 | 无 | `tryLock(time)` |
| 可中断等待 | `wait` 可中断 | `lockInterruptibly` |
| 公平 | 非公平 | `fair=true` 可选 |
| 多条件 | 单等待集 | 多个 `Condition` |

`synchronized` 锁的是**对象**：实例方法锁 `this`，静态锁 `Class`，块锁任意引用。两段代码字面相同、锁不同对象 → 不互斥。

AQS：`state==0` 空闲；同线程重入 `state++`；失败入 CLH 队列 + `park`。

## 原理

**P0：监视器进入/退出。** `monitorenter`：空闲则 owner+计数；已持有则重入+1。`monitorexit` 计数归零释放。异常路径编译器仍配对 exit。释放 hb 后继 acquire → 临界区写对下一持有者可见。

**专家加分：HotSpot 锁路径（口述即可）。** 偏向 → 轻量 CAS → 重量 park。Java 15+ 默认关偏向；Android ART 不等同 Mark Word 位图，但「先自旋再阻塞」方向可类比。

**P0：AQS 获取。** CAS `state` 0→1；失败看重入或入队 park。非公平允许 barge（释放瞬间插队），吞吐常更好；公平先看队列再 CAS，减少饥饿、增加上下文切换。

**P0：Condition。** `await` 须已持锁：原子释放锁 + 进条件队列；`signal` 后须重新抢锁才从 `await` 返回。`while` 再判条件（假醒 + 被偷改）。

**失败模式：** 持锁做 IO/网络 → 别人长时间 BLOCKED/WAITING，ANR 栈 `monitor contention`。协程在 `synchronized` 内挂起：锁绑线程，恢复可能换线程——Kotlin 禁止 suspend in synchronized。`StampedLock` 读写分离是另一条路：乐观读失败要升级，用错会数据竞争。

## 使用与实践

临界区只包共享状态的读改写。选锁：简单互斥用 `synchronized`；拿不到就放弃用 `tryLock`；生产者/消费者分条件用 `Condition`，少 `notifyAll` 误伤。

读多写少用 `StampedLock` 或并发容器，勿用大锁硬扛。SDK 文档写清「哪条线程、是否阻塞」；主线程抢 IO 线程占久的锁是经典 ANR。

## 例子

```java
// 对：专用 Condition + while
final ReentrantLock lock = new ReentrantLock();
final Condition notEmpty = lock.newCondition();
void consume() throws InterruptedException {
    lock.lockInterruptibly();
    try {
        while (q.isEmpty()) notEmpty.await();
        return q.remove();
    } finally { lock.unlock(); }
}
```

```java
// 错：每次 new 对象当锁——无互斥
synchronized (new Object()) { counter++; }

// 错：unlock 不在 finally——异常泄漏锁
lock.lock();
doWork(); // 抛异常后永不 unlock
lock.unlock();
```

转账防死锁：`id` 小账户先锁；或有序 `tryLock` 失败则释放已持有锁。

## 画面

```text
T1 lock 成功 --> state=1 owner=T1 --> 写 x
T1 unlock -----> state=0 ---- hb ----> T2 lock 见 x
```

## 常见坑与追问

1. **锁错对象。** 追问：私有 final `lock` 比锁 `this`？防外部同实例抢锁。
2. **漏 unlock。** 追问：`synchronized` 为何安全？编译器异常边补 monitorexit。
3. **公平/非公平误解。** 非公平非随机，是允许插队。追问：公平吞吐差？多一次队列检查与唤醒。
4. **把重入当跨线程。** 只认持有者线程。追问：协程 Mutex？不可重入，与监视器不同。
5. **持锁调用外部回调。** 错法：锁内 `listener.onX()` 回调再抢同锁。追问：与 Binder 死锁像在哪？循环等待不占 JVM 锁也能成立。
