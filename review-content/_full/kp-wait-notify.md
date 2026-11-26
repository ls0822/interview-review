---
id: kp-wait-notify
type: knowledge
module: concurrent
title: wait/notify/sleep/join/interrupt
priority: P0
version: 2
requires: [kp-synchronized-lock, kp-thread-basics]
order: 40
---

## 一句话

`sleep` 占线程不占锁的释放义务；`wait` 须在持锁时调用并会释放监视器；`interrupt` 是协作取消——不会强杀线程，失败常来自吞异常或 `if` 假醒。

## 组成与结构

| 调用 | 状态 | 锁 | 继续条件 |
|------|------|-----|----------|
| `sleep` | TIMED_WAITING | 不释放 | 超时/中断 |
| `wait` | WAITING | 释放 obj 锁 | notify/中断 |
| `wait(ms)` | TIMED | 释放 | 通知/超时/中断 |
| `join` | WAITING | 不持对方业务锁 | 目标 TERMINATED |
| `interrupt` | 置标记 | 视阻塞点 | 目标处理 |

`wait`/`notify` 在 `Object` 上，每对象有等待集。`notify` 唤醒一个不指定谁；被唤醒后要重新抢锁才从 `wait` 返回。协程 `delay` 挂起协程、让出工人，不走这张表。

## 原理

**P0：wait 为何持锁。** 原子完成「检查条件 → 入等待集 → 放锁」。否则在判假与 `wait` 之间丢 `notify`（丢失唤醒）。不持锁调用 → `IllegalMonitorStateException`。

**P0：返回后须 `while` 再判。** 假_wake 规范允许；更常见的是被叫醒后条件又被别人改掉。`if` 一次 → 在条件仍假时往下跑。

**P0：sleep vs wait。** 同步块内 `sleep` 不放锁，别人进不来也无法 `notify` 提前结束。限时等条件用 `wait(timeout)`。

**P0：join ≈ 在目标 Thread 上 wait。** 目标结束 `notifyAll` 自己的 Thread 对象。在别人 `Thread` 上乱 `notify` 搅乱 join。

**P0：中断与 hb。** 抛出 `InterruptedException` 的 API 清标记；若继续跑要 `Thread.currentThread().interrupt()`。中断成功建立与唤醒相关的可见性边界，但不替代业务条件变量的锁内检查。

**失败模式：** 条件在锁外改、`notify` 在 `wait` 前 → 永久睡眠。锁内 `sleep` → 死锁窗口放大。`notify` 在多条件场景叫醒错一侧 → 活锁式空转。

## 使用与实践

新代码优先 `BlockingQueue`、协程 `Channel`。遗留 Java：专用锁、`while`、改条件后 `notifyAll`、中断向上传。

主线程勿 `sleep`/`join` 等还要回主线程的线程。`InterruptedException` 勿空 catch，否则池 shutdown 停不下来。

## 例子

```java
// 对
synchronized (lock) {
    while (!ready) lock.wait();
    doWork();
}
synchronized (lock) {
    ready = true;
    lock.notifyAll();
}
```

```java
// 错：if 一次
synchronized (lock) {
    if (!ready) lock.wait(); // 假醒后继续
    doWork(); // ready 仍 false
}

// 错：锁外改条件
ready = true;
synchronized (lock) { lock.notifyAll(); } // 与 wait 侧无 hb，可能再睡死

// 错：锁内 sleep 等条件
synchronized (lock) {
    Thread.sleep(1000); // 占锁，别人无法 publish
}
```

## 画面

```text
持 lock -> !ready -> wait 放锁进等待集
发布：持 lock -> ready=true -> notifyAll -> 放锁
被叫醒 -> 抢 lock -> while 再看 ready
```

## 常见坑与追问

1. **`if` 非 `while`。** 追问：假醒 vs 被偷改？后者更常见，`while` 都挡。
2. **锁内 `sleep`。** 追问：与 `wait(timeout)`？wait 放锁且返回重入建立锁 hb。
3. **notify 不改条件或条件在锁外。** 追问：notify 早于 wait？通知作废，必须锁内先写条件。
4. **吞 `InterruptedException`。** 追问：为何清标记？API 约定；继续跑须补 interrupt。
5. **单 `notify` 多条件。** 错法：等满/等空混用只 notify 一个。追问：多 Condition 优势？精确唤醒，少惊群。