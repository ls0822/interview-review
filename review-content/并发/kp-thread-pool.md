---
id: kp-thread-pool
type: knowledge
module: concurrent
title: 线程池 ThreadPoolExecutor
priority: P0
version: 1
---

## 一句话

线程池用固定上限的工人加任务队列消化任务；新任务先填满核心线程，再进队列，队列满了才扩到最大线程，再满才拒绝。无界队列会让最大线程数永远用不上。

## 组成与结构

`ThreadPoolExecutor` 构造器里面试要能点名的是这七个：

| 参数 | 作用 |
|------|------|
| `corePoolSize` | 核心工人数。即使闲着也保留（除非 `allowCoreThreadTimeOut`） |
| `maximumPoolSize` | 工人上限 |
| `keepAliveTime` + 单位 | 超出核心的线程空闲多久被回收 |
| `workQueue` | 还没开始跑的任务 |
| `threadFactory` | 起线程、起名字、设异常处理器 |
| `RejectedExecutionHandler` | 队列和最大线程都满时怎么办 |

四个工厂方法要知道代价：`newFixedThreadPool` 固定 n 条加无界 `LinkedBlockingQueue`；`newSingleThreadExecutor` 一条线程保序，队列同样无界；`newCachedThreadPool` 核心为 0、最大为 `Integer.MAX_VALUE`、用 `SynchronousQueue`，来任务就加线程；`newScheduledThreadPool` 支持延迟和周期。业务池应自己写明有界队列，而不是用工厂方法碰运气。

协程 `Dispatchers.Default` / `IO` 背后也是调度器加线程，不是无限 `new Thread`。会讲线程池，才能讲清 IO 并行度默认至少 64、Default 大约按核数。

## 原理

任务从 `execute(Runnable)` 进来，顺序是固定的，中间不能跳步。

1. **工人数 < core。** 即使已有线程在闲着，也会再建一条核心线程来跑这个任务。这是为了先把核心编制填满，而不是「有空闲就复用」。所以池子刚启动时，连续提交 core 个任务会看到 core 条线程，而不是一条线程把队列吃光。
2. **核心已满。** 任务交给 `workQueue.offer`。成功就返回，不再加线程。队列里的任务由已有工人在 `getTask()` 里 `take` / `poll` 取走。
3. **offer 失败（队列满）且工人数 < max。** 再创建非核心线程直接跑这个任务。非核心线程空闲超过 `keepAliveTime` 会被回收。
4. **工人数已经是 max，或创建失败。** 走 `handler.rejectedExecution`。默认 `AbortPolicy` 抛 `RejectedExecutionException`。`CallerRunsPolicy` 让提交者自己在当前线程跑，形成反压。`DiscardPolicy` 丢掉且不通知。`DiscardOldestPolicy` 丢掉队头再试一次，可能把还没执行的旧任务静默扔掉。

因此「核心满了就扩到 max」是错的。中间隔着队列。`LinkedBlockingQueue` 不设容量时 `offer` 几乎总成功，第 3 步到不了，`maximumPoolSize` 是摆设，内存先被队列打满。

`shutdown()` 拒绝新任务，已在队列和正在跑的继续做完。`shutdownNow()` 对工人发中断，并把队列里没跑的任务作为列表返回，并不保证正在跑的立刻停，停不停看任务是否响应中断。`awaitTermination` 用来在进程退出前等一个时限。

周期任务若用 `scheduleAtFixedRate`，上一次还没结束，下一次不会重叠执行在同一条调度线程上，但任务本身若再丢进别的池，仍可能并发。异常若从定时任务里抛出且没抓住，后续周期会停，这是常见事故。

## 使用与实践

Android 上按职责拆池，不要一个全局无界池包打天下：

- 网络、磁盘：有界队列，核心数小（例如 2～4），拒绝时失败回调或稍后重试。更常见是直接用 `Dispatchers.IO`，但 IO 默认并行度很高，突发大文件仍要用 `limitedParallelism` 或信号量。
- 计算：核数附近，队列短，避免把 CPU 打满还堆内存。
- 要顺序的会话发送：单线程池或容量有界的 Channel 单消费者，保证同一会话不并发写。

`CallerRunsPolicy` 发生在主线程 `execute` 时，拒绝路径会把重活跑回主线程，可能 ANR。上传队列满了应显式失败，不要默默 `Discard`。

给 `threadFactory` 设 `UncaughtExceptionHandler`。线程池会把任务里的异常包住，定时任务更要自己 try，否则你以为在跑，其实早就停了。

## 例子

```java
ThreadPoolExecutor pool = new ThreadPoolExecutor(
        2, 4, 30, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(64),
        r -> {
            Thread t = new Thread(r, "upload");
            t.setDaemon(false);
            return t;
        },
        new ThreadPoolExecutor.AbortPolicy());

try {
    pool.execute(() -> upload(file));
} catch (RejectedExecutionException e) {
    onReject(file); // 让调用方决定重试，而不是丢在队列里
}

pool.shutdown();
if (!pool.awaitTermination(5, TimeUnit.SECONDS)) {
    pool.shutdownNow();
}
```

容量 64 的队列是背压点：第 2+64 个之后才会出现第 3、第 4 条线程，再多则抛拒绝。把队列换成 `new LinkedBlockingQueue<>()` 后，线程数会停在 2，任务无限堆积。

## 画面

```text
execute(task)
    |
    v
工人 < core ? --是--> 新建核心线程执行
    |否
    v
队列.offer 成功? --是--> 排队，等核心线程取
    |否
    v
工人 < max ? --是--> 新建非核心线程执行
    |否
    v
拒绝策略：抛 / 调用者跑 / 丢 / 丢最旧
```

## 常见坑与追问

1. **无界队列。** 追问：为什么监控上线程数正常、内存却涨？任务都在 `LinkedBlockingQueue` 节点里，max 没参与。
2. **`newCachedThreadPool` 接用户流量。** 每个任务一条线程，栈内存先 OOM。追问：它为什么看起来「没有队列」？`SynchronousQueue` 不存元素，移交失败就加线程。
3. **`shutdownNow` 当成强杀。** 不响应中断的死循环照样跑。追问：和协程 `cancel` 像在哪？都是协作式，都要任务在检查点停下来。
4. **主线程提交 + `CallerRuns`。** 追问：ANR 栈会停在哪？停在业务任务里，看起来像主线程自己在做重活，根因是池满了的拒绝路径。
