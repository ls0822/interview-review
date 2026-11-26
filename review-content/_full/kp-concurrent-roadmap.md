---
id: kp-concurrent-roadmap
type: knowledge
module: concurrent
title: 并发掌握地图与复习顺序（专家）
priority: P0
version: 2
order: 1
---

## 一句话

并发面试不是背锁 API：先建立「可见性、原子性、有序性」三板斧，再沿 synchronized / CAS / 线程池讲到死锁与容器，并且每一句都能接到 JMM 上。

**P0 必会**开口要讲对 happens-before 与锁语义。**专家加分**是追问锁优化、伪共享、池饱和时仍能讲清失败形态。

## 组成与结构

| 层 | 要回答的问题 | 主篇 | 档 |
|----|----------------|------|----|
| 线程模型 | 线程状态、启动成本、与协程的边界 | `kp-thread-basics` | P0 必会 |
| 可见性与 hb | `volatile`、happens-before 边 | `kp-volatile-hb` | P0 必会 |
| 互斥 | `synchronized`、锁升级直觉、与 `ReentrantLock` | `kp-synchronized-lock` | P0 必会 |
| 无锁 CAS | ABA、自旋、与锁的取舍 | `kp-cas-atomic` | P0 必会 |
| 等待通知 | `wait`/`notify` 必须在哪持有锁 | `kp-wait-notify` | P0 必会 |
| 线程池 | 队列、拒绝策略、为什么别 `Executors` | `kp-thread-pool` | P0 必会 |
| 并发容器 | `ConcurrentHashMap` 与迭代弱一致 | `kp-concurrent-collections` | P0 必会 |
| 死锁 | 必要条件、检测与顺序加锁 | `kp-deadlock` | P0 必会 |
| 内存模型底座 | JMM 与主内存工作内存 | `kp-jmm` | 专家加分（与 JVM 模块交叉） |

P0 要点：

- 没有同步，两个线程读写同一 `var` 没有 happens-before，可见性不保证。
- `volatile` 保证可见性与禁重排，不保证复合操作原子性。
- `synchronized` 释放锁 happens-before 后一线程获取同锁。
- 池满时 `CallerRuns` / `Abort` 各对用户请求意味着什么。

专家加分：

- `ConcurrentHashMap` 1.8+ 分段/bin 锁与 size 计数近似语义。
- `ThreadLocal` 与线程池复用导致的数据泄漏。
- `park`/`unpark` 相对 `wait`/`notify` 的语义差。

## 原理

这一节是深层原理必掌握清单。并发题先画 happens-before，再套 API；答不上「为什么看见」一律回到 `kp-jmm`。

### 1. JMM 与 happens-before（P0 必会）

JMM 规定哪些读写之间能建立**先行发生**边：程序次序、监视器锁规则、volatile、线程 `start`/`join` 等。没有 hb 边，两个线程对同一变量的读写**不存在**跨线程的可见性保证，即使你「觉得已经写了」。直觉对比：CPU 缓存与编译器重排是现实，hb 是程序员能依赖的契约。失败模式：用普通 `boolean` 当停止标志但不 volatile，JIT 会把读 hoist 到循环外，worker 永远不停。见 `kp-jmm`、`kp-volatile-hb`。

### 2. volatile 的语义边界（P0 必会）

对 volatile 的写 hb 于后续对该 volatile 的读，并限制与之相关的重排；**不**保证 `i++` 原子性，因为读-改-写仍是三步。双重检查锁定单例：构造未完成就发布引用需要 volatile 拦指令重排。与 `synchronized` 对比：volatile 只钉可见性/部分有序，不互斥复合操作。专家边界：`Atomic*` 的 `lazySet` 弱于 volatile 写。见 `kp-volatile-hb`、`kp-cas-atomic`。

### 3. 监视器锁与条件变量（P0 必会）

`synchronized` 进入/退出建立 hb；同一把锁上的 unlock hb 于后一线程的 lock。`wait` 必须持有监视器，调用时**释放锁**并阻塞；`notify` 只唤醒，醒后还要重新抢锁。错法：在 `if` 里等条件——虚假唤醒应用 `while` 复检。与 `ReentrantLock` + `Condition` 对比：可中断、可定时、公平策略可选，但要记得在 `finally` 里 `unlock`。见 `kp-synchronized-lock`、`kp-wait-notify`。

### 4. CAS、乐观锁与 ABA（P0 必会）

CAS 比较内存值与期望，相等则交换；失败自旋或退避。适合计数、无锁栈/队列的节点更新，不适合长时间临界区——高争用下自旋烧 CPU。ABA：值从 A→B→A，CAS 误以为没变；栈式结构用带版本戳的引用或避免节点复用。与悲观锁对比：锁把阻塞交给 OS，CAS 把重试留在用户态。失败模式：以为 `AtomicInteger` 能替代所有 `synchronized` 块。见 `kp-cas-atomic`。

### 5. 线程池与背压（P0 必会）

池 = 工作线程 + 任务队列 + 拒绝策略。有界队列 + 固定最大线程数，饱和时按策略：抛异常、`CallerRuns`（调用方线程执行，形成反压）、丢弃等。`Executors.newCachedThreadPool` 无界线程增长在流量尖刺下是 OOM 温床。与协程 Dispatcher 对比：池控的是 OS 线程，协程挂起不占用工人。Android 主线程绝不应被 `CallerRuns` 拖死。见 `kp-thread-pool`。

### 6. 并发容器与弱一致（P0 必会）

`ConcurrentHashMap` 细粒度锁或 CAS + 辅助结构，读通常无锁路径；**迭代器弱一致**，反映迭代开始后的某一时刻快照倾向，不抛 CME 也不保证包含刚写入。`size()` 可能是近似。与 `Collections.synchronizedMap` 对比：后者整表锁，迭代要手动包同步块。失败模式：在 `forEach` 里做结构性删除以为安全。见 `kp-concurrent-collections`。

### 7. 死锁四要素与破坏（P0 必会）

互斥、占有且等待、不可抢占、循环等待——四者齐则死锁。检测靠线程 dump 环；预防靠**全局加锁顺序**、超时 `tryLock`、银行家算法口述级即可。与活锁、饥饿区分：活锁双方让步但无进展。`kp-deadlock` 要结合 `kp-synchronized-lock` 画两线程交叉持锁。

### 8. 与协程的交界（专家加分）

协程不消灭共享可变状态：`Default` 上多协程真并行改同一 `var` 仍无 hb。互斥靠 `Mutex`、单线程调度视图，或不可变数据。线程池里的阻塞 IO 与协程 IO 调度是两套配额，混讲会误导。见 `kp-coroutine-channel-mutex`（交叉引用，不在本篇展开）。

## 使用与实践

先读 `kp-jmm` 或与 `kp-volatile-hb` 交叉，再按表顺序；`kp-thread-basics` 的 requires 指向 JMM 是刻意的。

1. `kp-thread-basics` — 线程谁创建、栈多大、状态迁移。
2. `kp-volatile-hb` — 举 flag 停止线程对/错两路。
3. `kp-synchronized-lock` — 锁范围、死锁雏形。
4. `kp-cas-atomic` — 计数器 CAS vs synchronized。
5. `kp-wait-notify` — 生产者消费者为什么用 while 不用 if。
6. `kp-thread-pool` — OkHttp/业务线程池参数怎么口述。
7. `kp-concurrent-collections` — 迭代时能否 add。
8. `kp-deadlock` — 转账类题固定加锁顺序。

串讲：主线程改 flag，工作线程读；再改成 `volatile`；再改成 `synchronized`；最后说协程里仍要靠 Mutex/单线程视图（引 `kp-coroutine-channel-mutex`，不展开）。

## 例子

```text
错：bool stop 无 volatile，worker 循环永不结束（CPU 可见性）
对：volatile stop 或 synchronized 写读同一锁
错：池子 Cached + 无限任务 → 线程数爆
对：有界队列 + 明确拒绝，饱和可观测
```

## 画面

```text
jmm (底座) ---- thread-basics
                    |
         volatile-hb -> synchronized-lock -> cas-atomic
                    |
              wait-notify -> thread-pool
                    |
         concurrent-collections -> deadlock
```

## 常见坑与追问

1. **把 volatile 当锁。** 追问：`count++` 用 volatile 够吗？
2. **`notify` 丢信号。** 为什么用 `notifyAll` 且 while 检查条件？
3. **`synchronized` 锁的是对象不是代码块字面量。** 追问：intern 过的字符串当锁？
4. **线程池队列无限。** 追问：何时 OOM、指标上看什么？
5. **ConcurrentHashMap 当完全线程安全迭代。** 追问：forEach 中能 remove 吗？