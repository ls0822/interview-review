---
id: kp-thread-pool
type: knowledge
module: concurrent
title: 线程池 ThreadPoolExecutor
priority: P0
version: 2
requires: [kp-thread-basics]
order: 50
---

## 一句话

线程池用有上限工人 + 任务队列消化工作：先填满核心线程，再入队，队满才扩到最大，再满才拒绝——无界队列会让 `maximumPoolSize` 永远用不上，失败模式是 OOM 和主线程 `CallerRuns` ANR。

## 组成与结构

构造七参：`corePoolSize`、`maximumPoolSize`、`keepAliveTime`、`workQueue`、`threadFactory`、`RejectedExecutionHandler`。

工厂方法代价：

| 工厂 | 风险 |
|------|------|
| `newFixedThreadPool` | 无界 `LinkedBlockingQueue`，max 无效 |
| `newCachedThreadPool` | max=MAX，SynchronousQueue，线程数暴涨 |
| `newSingleThreadExecutor` | 无界队列，顺序执行 |
| `newScheduledThreadPool` | 定时；未捕获异常停后续周期 |

`Dispatchers.Default`/`IO` 背后也是池化调度，懂池才懂 IO 并行度与反压。

## 原理

**P0：`execute` 顺序（不能跳步）。**

1. 线程数 < core → 新建核心线程跑任务（即使有空闲核心也可能先建——填满编制）。
2. 否则 `queue.offer` 成功 → 排队，核心 `getTask` 取。
3. offer 失败且线程 < max → 建非核心线程跑当前任务；空闲超 keepAlive 回收。
4. 否则 `handler.rejectedExecution`。

故「核心满就扩 max」错，中间隔队列。无界 `LinkedBlockingQueue` → 步骤 3 永不到，内存先被队列吃光。

**P0：关闭语义。** `shutdown` 拒新、做完已在跑与队列中。`shutdownNow` 中断工人 + 返回未跑任务列表；正在跑的不保证停，看任务是否响应中断。`awaitTermination` 限时等。

**专家加分：定时任务。** `scheduleAtFixedRate` 上次没完不会重叠在同调度线程；任务内再丢无界池仍可能并发。未捕获异常 → 后续周期停。

**失败模式：** `CallerRunsPolicy` 在 UI 线程 `execute` → 拒绝路径主线程跑重活，ANR。`Discard*` 静默丢任务，线上以为在上传。`shutdownNow` 对不查中断的死循环无效。

## 使用与实践

按职责拆池：网络/磁盘有界队列 + 小核心 + 明确拒绝；计算贴近核数 + 短队列。会话顺序：单线程池或单消费者 Channel。

拒绝要回调/重试，勿默认 CallerRuns 在可能的主线程。`threadFactory` 命名 + `UncaughtExceptionHandler`。

## 例子

```java
// 对：有界队列背压
ThreadPoolExecutor pool = new ThreadPoolExecutor(
    2, 4, 30, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(64),
    r -> new Thread(r, "upload"),
    new ThreadPoolExecutor.AbortPolicy());
try { pool.execute(() -> upload(file)); }
catch (RejectedExecutionException e) { onReject(file); }
```

```java
// 错：无界队列——线程永远 2，任务堆进堆 OOM
new ThreadPoolExecutor(2, 4, 0L, SECONDS,
    new LinkedBlockingQueue<>(), ...);

// 错：主线程 execute + CallerRuns，池满后 UI 跑 upload
new ThreadPoolExecutor(..., new CallerRunsPolicy());
// Activity 里 pool.execute(heavy)
```

## 画面

```text
execute -> workers<core? 新建核心
       -> offer 队列? 排队
       -> workers<max? 新建非核心
       -> 拒绝策略
```

## 常见坑与追问

1. **无界队列。** 追问：线程数正常内存涨？任务在队列节点里。
2. **`newCachedThreadPool` 接流量。** 追问：看似无队列？`SynchronousQueue` 不存元素，移交失败加线程。
3. **`shutdownNow` 当强杀。** 追问：与协程 cancel？都协作，要在检查点停。
4. **主线程 + CallerRuns。** 追问：ANR 栈？业务代码在主线程，根因池满。
5. **一个全局无界池包全部。** 错法：上传/解析/打点共用且无界。追问：如何拆？职责池 + 有界 + 命名便于 traces。
