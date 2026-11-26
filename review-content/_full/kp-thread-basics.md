---
id: kp-thread-basics
type: knowledge
module: concurrent
title: 线程模型与线程状态
priority: P0
version: 1
---

## 一句话

线程是进程内被调度的执行单位：共享堆、各有栈；Java 把「就绪」和「正在跑」都记成 RUNNABLE，BLOCKED 只表示在等 synchronized 的监视器。

## 组成与结构

一个 Android 进程里，操作系统看到的是地址空间和若干内核线程。JVM / ART 在这之上再给每条 Java 线程配一套私有结构：

| 部分 | 谁私有 | 放什么 |
|------|--------|--------|
| 堆 | 进程内线程共享 | 对象、数组 |
| 方法区 / 元空间 | 共享 | 类元数据、运行时常量池 |
| Java 栈 | 每线程一份 | 栈帧：局部变量、操作数栈、返回地址 |
| 程序计数器 | 每线程一份 | 下一条字节码 |
| 本地方法栈 | 每线程一份 | JNI 调用 |

创建方式只有两条路真正常用：实现 `Runnable` 再交给 `Thread`，或直接 `new Thread(runnable)`。`run()` 只是当前线程上的普通方法调用；`start()` 才会让虚拟机去向操作系统申请调度，进入 RUNNABLE。业务代码不要来一个任务就 `new Thread`，线程有栈（Android 上常见约 1MB 量级）、创建和切换都贵，应交给线程池或协程 Dispatcher。

线程对象和内核线程不是同一个东西。`Thread` 实例在堆上，是 Java 侧的手柄；真正占 CPU 的是被调度的内核线程。`Thread.getState()` 读的是 JVM 维护的状态，不是 Linux 的 `R/S/D`。

## 原理

状态机按这个顺序讲，面试官要的是「什么动作触发迁移」，不是背枚举名。

1. **NEW。** `new Thread(...)` 只在堆上建对象，还没有内核线程。此时调用除 `start` 以外的多数控制方法没有意义。
2. **start() → RUNNABLE。** JVM 创建内核线程并登记。Java 不区分「在就绪队列」和「正在 CPU 上跑」，两者都是 RUNNABLE。所以看到 RUNNABLE 不能断言它此刻占着核，只能说它有资格被调度。
3. **BLOCKED。** 只有一种主因：要进入 `synchronized`，而这把监视器被别的线程占着。等 `ReentrantLock`、`LockSupport.park`、`Object.wait` 都不算 BLOCKED。这个区分是追问高频点。
4. **WAITING。** 没有超时的等待：`Object.wait()`、`Thread.join()`、`LockSupport.park()`。线程不占 CPU，直到被对应的唤醒动作叫醒（`notify` / `join` 的目标结束 / `unpark`）。
5. **TIMED_WAITING。** 带时限的等待：`sleep(ms)`、`wait(ms)`、`join(ms)`、`parkNanos`。时间到了自己回到 RUNNABLE，不必别人叫醒。
6. **TERMINATED。** `run()` 正常返回或未捕获异常把线程打穿。同一 `Thread` 对象不能再次 `start()`，再调会抛 `IllegalThreadStateException`。

同一条线程上，操作系统可以抢占：时间片到了就换人，这和协程不同。协程是协作式，只有跑到挂起点才让出工人。所以「两个 Java 线程」可以在多核上真并行；「两个协程绑在同一条线程」不能。

`yield()` 只是提示调度器「我可以让一下」，不释放任何锁，也不保证真的切走。面试把它和 `sleep`、`wait` 分开：`yield` 没有等待集，没有超时契约。

中断是协作标记，不是杀线程。`interrupt()` 把目标的中断位置位。若目标正堵在 `sleep` / `wait` / `join` / 可中断锁上，会抛 `InterruptedException` 并清掉标记。若目标在纯计算，它必须自己读 `Thread.interrupted()` 或 `isInterrupted()` 才停得下来。吞掉异常又不恢复标记，等于把中断弄丢。

## 使用与实践

Android 主线程是一条带 `Looper` 的线程，输入、绘制、生命周期都在它的消息队列里排队。主线程进入长时间 RUNNABLE（解析大 JSON、解码）或 BLOCKED（主线程等锁、等 Binder），都可能 ANR。后台线程不要直接改 View。

选型口诀：

- 一次性、要结果、要取消：协程 `viewModelScope` / `lifecycleScope`，Dispatcher 背后仍是线程池。
- 必须和 Java 阻塞 API 共存、要限并发：自己 `ThreadPoolExecutor`，有界队列。
- 需要消息循环：`HandlerThread`，不要手写 `Looper.prepare` 忘了 `quit`。
- 不要用 `Executors.newCachedThreadPool()` 接突发任务，线程数会随任务涨。

线程命名用 `threadFactory` 加上业务前缀（`upload-`、`im-send-`）。ANR traces 和 `jstack` 里，没名字的池线程几乎无法对应到模块。

## 例子

```java
final Object lock = new Object();

Thread worker = new Thread(() -> {
    synchronized (lock) {
        try {
            lock.wait(); // WAITING，并放开 lock
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return;
        }
    }
}, "demo-worker");

System.out.println(worker.getState()); // NEW
worker.start();
Thread.sleep(50);
System.out.println(worker.getState()); // 多半是 WAITING

synchronized (lock) {
    lock.notifyAll();
}
worker.join(); // 当前线程 TIMED 或 WAITING，直到 worker 结束
System.out.println(worker.getState()); // TERMINATED
```

把 `wait()` 换成在 `synchronized (lock)` 外面空转，状态会停在 RUNNABLE。另一条线程若也要进同一把 `lock`，它的状态才是 BLOCKED。

## 画面

```text
NEW --start()--> RUNNABLE <--+
                   |  |      |
        等 monitor |  | sleep/wait(超时)
                   v  v      |
                BLOCKED   TIMED_WAITING
                   |         |
                   +----+----+
                        |
              wait/join/park 无超时
                        v
                     WAITING
                        |
                   run 结束
                        v
                   TERMINATED
```

## 常见坑与追问

1. **把 BLOCKED 和等锁混为一谈。** 追问：`ReentrantLock.lock()` 堵在外面时 `getState()` 是什么？答 WAITING（内部 `park`），不是 BLOCKED。BLOCKED 几乎只对应 `synchronized`。
2. **`run()` 和 `start()` 搞反。** 直接 `run()` 不会有新线程，状态也不会离开当前调用方。追问：为什么 `start()` 两次会崩？因为状态已经不是 NEW。
3. **中断被吞。** `catch (InterruptedException)` 里只打日志，标记被清掉，上层和线程池不知道任务被取消。正确做法是恢复标记或继续抛出。追问：`isInterrupted` 和 `interrupted` 差在哪？后者会清除标记。
4. **主线程上 `join` 子线程。** 子线程若还要回主线程投消息，主线程又在 `join`，形成环。追问：这和死锁有何异同？锁可能没出现，但循环等待已经成立，ANR 栈会停在 `join`。
