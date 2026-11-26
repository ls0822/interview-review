---
id: kp-wait-notify
type: knowledge
module: concurrent
title: wait/notify/sleep/join/interrupt
priority: P0
version: 1
---

## 一句话

`sleep` 占着线程也占着锁；`wait` 必须在该对象的同步块里调用，并且会放开这把锁；`interrupt` 只是协作标记，不会强行把线程撕掉。

## 组成与结构

这五个词都作用在「当前线程怎么停、谁来让它继续」，但停的层次不同。

| 调用 | 线程 | 监视器锁 | 怎么继续 |
|------|------|----------|----------|
| `Thread.sleep` | 进入 TIMED_WAITING | 不释放 | 时间到或中断 |
| `obj.wait()` | WAITING | 释放 obj 这把锁 | `notify` / `notifyAll` 或中断 |
| `obj.wait(ms)` | TIMED_WAITING | 释放 obj | 通知、超时或中断 |
| `other.join()` | WAITING | 不涉及 other 的业务锁 | other 结束 |
| `yield` | 仍是 RUNNABLE | 不释放 | 只是调度提示 |
| `interrupt` | 置标记；若堵在可中断点则抛异常 | 视堵在哪 | 目标自己处理 |

`wait` / `notify` 是 `Object` 的方法，不是 `Thread` 的。每个对象除了监视器，还有一个等待集。`notify` 从等待集里叫一个，叫谁不保证；`notifyAll` 全叫，被叫醒的线程还要重新抢锁，抢到才能从 `wait` 返回。

协程的 `delay` 不在这张表里：它挂起的是协程，工人线程去干别的，既不占用 `sleep` 那种线程，也不走对象监视器。

## 原理

1. **为什么 wait 必须持有锁。** `wait` 要做两件不可分割的事：检查条件、把自己放进等待集并放开锁。若没有锁，会出现「看完条件为假，还没 wait，对方已经 notify」的丢失唤醒。所以 JVM 规定不持有该对象监视器就 `wait` / `notify`，直接 `IllegalMonitorStateException`。
2. **返回前要重新拿到锁。** `notify` 只是把线程移出等待集，并不把锁交给它。它要和其他想进同步块的线程再竞争。所以 `wait` 返回后，你不能假设当初等的那个条件仍为真：可能被别人又改回去，也可能是虚假唤醒。条件必须用 `while` 再判一次。
3. **虚假唤醒。** 规范允许 `wait` 在没有 `notify` 的情况下返回。用 `if` 只等一次，就会在条件不成立时往下跑。这是写法错误，不是某个手机系统的偶发 bug。
4. **sleep 不放锁。** 同步块里 `sleep`，别的线程既进不了这把锁，也没法用 `notify` 提前结束这次睡眠（除非中断）。想「等一个条件，最多等 100ms」应该用 `wait(100)`，而不是 `sleep`。
5. **join 的实现可以理解为在目标线程对象上 wait。** 目标线程结束时会 `notifyAll` 它自己的 `Thread` 对象。在别人的 `Thread` 对象上乱 `notify`，可能搅乱 `join`。业务条件请用自己的锁对象。
6. **中断是协作。** `interrupt` 把标志设为 true。若线程堵在 `sleep`、`wait`、`join`、`lockInterruptibly`，会抛 `InterruptedException` 并清除标志。纯计算循环必须自己看 `isInterrupted()`。捕获异常后如果选择继续跑，要 `Thread.currentThread().interrupt()` 把标志补回去，否则上层线程池以为没人请求取消。

`notify` 与 `notifyAll`：只有一种等待条件、且叫醒任意一个都能正确工作时，可以用 `notify`。存在「有的线程在等数据、有的在等空位」时，`notify` 可能叫醒错误的那种，正确的那种继续睡，造成信号丢失。拿不准就 `notifyAll`，或者改用 `ReentrantLock` 的多个 `Condition`。

## 使用与实践

新代码的生产消费优先阻塞队列或协程 `Channel`，它们把 wait/notify 包好了。还在维护的 Java 模块里，手写等待必须同时满足：专用锁对象、`while` 条件、改条件的线程持同一把锁再 `notifyAll`、中断要传递。

主线程不要 `sleep` 等后台，也不要 `join` 一条还要回到主线程回调的线程。页面倒计时用 `postDelayed` 或 `delay`，离开页面就移除回调或取消协程。

`InterruptedException` 不要空 catch。线程池任务、阻塞队列的 `put` / `take` 都会抛它，吞掉会导致关闭池时任务停不下来。

## 例子

```java
final Object lock = new Object();
boolean ready = false;

void worker() throws InterruptedException {
    synchronized (lock) {
        while (!ready) {
            lock.wait(); // 放开 lock，进等待集
        }
        doWork();
    }
}

void publisher() {
    synchronized (lock) {
        ready = true;      // 先改条件，再通知
        lock.notifyAll();
    }
}
```

若 `publisher` 在同步块外写 `ready = true` 再 `notify`，中间没有 hb，等待线程被叫醒后可能仍看见 `ready == false`，于是 `while` 再等一次，这次就没人再通知了，永久睡下去。条件和通知必须在同一把锁里。

中断版睡眠：

```java
try {
    Thread.sleep(1_000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

## 画面

```text
持有 lock
  看到 !ready
  wait() -------- 释放 lock，进入等待集
                      ^
发布线程：拿到 lock，ready=true，notifyAll，释放 lock
                      |
被叫醒的线程重新竞争 lock，抢到后 while 再看 ready
```

## 常见坑与追问

1. **用 if 而不是 while。** 追问：虚假唤醒和「被叫醒但条件又被别人改掉」哪个更常见？后者更常见，`while` 两个都挡住。
2. **sleep 放在锁里。** 追问：和 `wait(timeout)` 的可见性差在哪？`wait` 会释放并在返回时重新建立这段锁的 hb；`sleep` 锁都不放。
3. **只 notify 不改条件，或改条件不在锁里。** 丢失唤醒。追问：`notify` 早于 `wait` 会怎样？这次通知作废，所以条件变量本身要先写好，`wait` 前再检查。
4. **吞掉 InterruptedException。** 追问：标志为什么会被清？因为抛异常的 API 约定清除它，避免上层重复处理；你若继续运行就要补回标志。
