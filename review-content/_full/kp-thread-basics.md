---
id: kp-thread-basics
type: knowledge
module: concurrent
title: 线程模型与线程状态
priority: P0
version: 2
requires: [kp-jmm]
order: 10
---

## 一句话

线程是进程内被调度的执行单位：共享堆、各有栈；Java 把「就绪」和「正在跑」都记成 RUNNABLE，BLOCKED 只表示在等 `synchronized` 的监视器——和 `park`、等 `Lock` 不是一回事。

## 组成与结构

Android 进程里，操作系统管地址空间和内核线程；JVM / ART 再给每条 Java 线程配私有运行时结构。

| 部分 | 谁私有 | 放什么 |
|------|--------|--------|
| 堆 | 进程内共享 | 对象、数组 |
| 元空间 | 共享 | 类元数据 |
| Java 栈 | 每线程一份 | 栈帧：局部变量、操作数栈 |
| 程序计数器 | 每线程一份 | 下一条字节码 |
| 本地方法栈 | 每线程一份 | JNI |

创建路径：`Runnable` + `Thread.start()`。`run()` 只是当前线程上的普通调用；`start()` 才申请内核调度。业务不要来一个任务就 `new Thread`——栈常见约 1MB、创建与切换都贵，交给线程池或协程 Dispatcher。

`Thread` 实例是堆上手柄；占 CPU 的是内核线程。`getState()` 读 JVM 状态，不是 Linux 的 `R/S/D`。ART 与 HotSpot 状态枚举一致，实现细节不必背到 ART，但 ANR traces 里要能对照。

## 原理

**P0：状态迁移靠「什么动作」，不靠背枚举。**

1. **NEW → RUNNABLE。** `start()` 创建内核线程。RUNNABLE 不区分就绪队列与正在占核，不能从状态断言「此刻在跑」。
2. **BLOCKED。** 主因：等进入 `synchronized` 而该监视器被占。`ReentrantLock`、`LockSupport.park`、`Object.wait` 都不是 BLOCKED（多数是 WAITING / TIMED_WAITING）。资深追问高发。
3. **WAITING / TIMED_WAITING。** 无超时：`wait()`、`join()`、`park()`；有超时：`sleep`、`wait(ms)`、`join(ms)`。`wait` 会释放监视器；`sleep` 不会。
4. **TERMINATED。** 同一 `Thread` 不能二次 `start()`，否则 `IllegalThreadStateException`。

**P0：抢占与协作。** Java 线程可被 OS 抢占；协程在同线程上协作让出。多 Java 线程可多核并行；同线程上两个协程不能真并行。

**P0：中断是协作标记。** `interrupt()` 置位；堵在 `sleep` / `wait` / `join` / 可中断锁上会抛 `InterruptedException` 并清标记。纯计算必须自己查 `isInterrupted()`。吞异常不恢复标记 → 取消链路断裂（线程池 shutdown、协程 cancel 都依赖这条边）。

**专家加分：与 happens-before 的边。** `start()` 之前的写 hb 子线程内动作；子线程写 hb 父线程 `join()` 返回之后。不靠 volatile 也能把「启动前配置」交给子线程看见，靠的是 start/join 规则，不是魔法可见性。

**失败模式：** 主线程 `join` 子线程，子线程又要主线程 Handler 投递 → 环（未必有锁，仍是循环等待，ANR 栈停在 `join`）。守护线程 `daemon` 随进程退，但若任务没写完数据，可能丢尾部刷新。

## 使用与实践

主线程带 `Looper`：输入、绘制、生命周期排队执行。主线程长时间 RUNNABLE（大 JSON）或 BLOCKED（等锁、等 Binder）→ ANR。后台勿直接改 View。

选型：结构化并发用协程 Scope + Dispatcher；与 Java 阻塞 API 共存、要限并发 → 有界 `ThreadPoolExecutor`；要消息循环 → `HandlerThread`；勿用无界 `newCachedThreadPool` 接突发流量。

`threadFactory` 命名（`upload-`、`net-`），ANR / `jstack` 才对得上模块。`UncaughtExceptionHandler` 挂在工厂上，池任务异常不会自动冒泡。

## 例子

```java
// 对：wait 必须在持有锁的块里，状态 WAITING 且释放 lock
final Object lock = new Object();
Thread worker = new Thread(() -> {
    synchronized (lock) {
        try { while (!done) lock.wait(); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}, "demo-worker");
worker.start();
```

```java
// 错：把 run 当 start——永远在调用方线程执行，没有并发
new Thread(() -> heavyWork()).run();

// 错：吞中断，池 shutdown 后任务仍空转
try { doBlocking(); }
catch (InterruptedException e) { log(e); /* 未 interrupt() */ }
```

在 `synchronized (lock)` 外自旋等条件 → worker 保持 RUNNABLE 烧 CPU；另一线程要等同一把锁时才是 BLOCKED。

## 画面

```text
NEW --start()--> RUNNABLE <--+
                   |  |      |
        等 monitor |  | sleep/wait(超时)
                   v  v      |
                BLOCKED   TIMED_WAITING
                   |         |
                   +----+----+
              wait/join/park
                        v
                     WAITING
                   run 结束
                        v
                   TERMINATED

BLOCKED ≠ park 等 Lock（那是 WAITING）
```

## 常见坑与追问

1. **BLOCKED 与「等锁」混为一谈。** 错法：看到线程 WAITING 就说在等锁。追问：`ReentrantLock.lock()` 阻塞时 `getState()`？答 WAITING（内部 park），不是 BLOCKED。
2. **`run()` / `start()` 颠倒。** 错法：池外 `task.run()`。追问：为何不能 `start()` 两次？状态已非 NEW。
3. **中断被吞。** 错法：catch 后只打日志。追问：`interrupted()` 与 `isInterrupted()`？前者读并清标记。
4. **主线程 `join` 等要回主线程的任务。** 错法：UI 线程 join 网络线程，网络线程 `runOnUiThread` 卡死。追问：与经典死锁四条件的关系？循环等待成立，未必互斥在 Java 锁上。
5. **误用守护线程做必达刷盘。** 错法：daemon 写库，进程杀时线程直接被砍。追问：何时用 daemon？只持后台辅助，不承载必须完成的副作用。