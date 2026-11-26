---
id: kp-deadlock
type: knowledge
module: concurrent
title: 死锁条件与排查
priority: P0
version: 2
requires: [kp-synchronized-lock, kp-wait-notify]
order: 70
---

## 一句话

死锁是一组线程或协程**循环等待**对方持有的锁；四条件同时成立才发生——工程上最常拆「循环等待」：全局加锁顺序或 `tryLock` 退让；失败也常是 Binder/主线程环，而不止两把 Java 监视器。

## 组成与结构

| 条件 | 含义 | 破坏手段 |
|------|------|----------|
| 互斥 | 资源独占 | 通常不能破 |
| 占有且等待 | 拿着 A 等 B | `tryLock` 超时放下 |
| 不可剥夺 | 不能抢锁 | 用退让代替 |
| 循环等待 | 等有向环 | **固定顺序**、排序多锁 |

`synchronized` 同线程重入不是死锁；`Mutex` 不可重入，同协程二次 `withLock` 自己等自己（环长 1）。

活锁：大家都在退让重试无进展。饥饿：公平性差，某线程长期抢不到。面试先死锁再补两词。

## 原理

**P0：环如何闭。** T1 持 A 等 B；T2 持 B 等 A。释放条件互相依赖，谁也走不到 unlock。

**P0：全局顺序拆环。** 转账按账户 id 从小到大加锁 → 「持大等小」的边消失。

**P0：tryLock 退让。** 按序试锁，失败释放已持有，退避重试。代价：业务可重试、持有第一把时忌不可逆副作用。

**专家加分：协程。** 双 `Mutex` 反序同线程死锁；`withLock` 内 `delay` **不放锁**，窗口比 `sleep` 在同步块还大。持锁 `withContext(IO)` 再等主线程上要同锁的协程 → 跨 Dispatcher 环。

**专家加分：非 Java 锁环。** 主线程 Binder 同步等对方，对方回调占主线程资源；DB 行锁；Mutex 栈在 kotlinx 挂起点，结合线程名与持有锁日志。

**失败模式：** 持锁调外部回调/监听器再抢锁。线上只能靠 traces：`BLOCKED` on monitor、`WAITING` on `ReentrantLock`；记录锁身份与线程名，匿名 pool 线程无法定位模块。

## 使用与实践

锁短、不持锁 IO/回调。能队列移交所有权就少共享可变。协程：状态单线程 Dispatcher；`Mutex` 只包改字段，不包 `delay`/`withContext`。

死锁后重启只清场；预防靠命名、有序加锁、tryLock 策略、避免主线程长同步 Binder。

## 例子

```java
// 对：按 id 排序加锁
Account first = a.id < b.id ? a : b, second = a.id < b.id ? b : a;
synchronized (first) {
    synchronized (second) { transfer(a, b, n); }
}
```

```java
// 错：动态顺序——看谁先抢到
synchronized (payer) {
    synchronized (payee) { /* 另一路径 payer/payee 相反 */ }
}

// 错：tryLock 只试一次不等退避，仍可能活锁空转
if (!lockA.tryLock()) return;
if (!lockB.tryLock()) { /* 忘 unlock A */ }
```

```kotlin
// 错：Mutex 嵌套同一把
mutex.withLock { mutex.withLock { } }
```

## 画面

```text
T1 持A --等--> B被T2持
 ^                |
 +--- A被T1持 <-- 等 -- T2持B

拆环：全员先 A 后 B
```

## 常见坑与追问

1. **只背四条件无例。** 追问：不可剥夺为何难破？没有抢监视器 API，只能自己放。
2. **以为协程挂起放 Mutex。** 追问：像 `sleep` 在 synchronized？都占锁等时间。
3. **synchronized 嵌套同一锁当死锁。** 重入+1。追问：Mutex 为何不记重入？第二次 lock 等未发生的 unlock。
4. **主线程 Binder 环。** 追问：栈上两把 Java 锁？未必，但循环等待成立，主线程 `transact`。
5. **持锁调用 `runOnUiThread`/`withContext(Main)`。** 错法：后台锁内等主线程，主线程又要该锁。追问：与经典 AB-BA 同构？是，资源换成线程+锁组合。