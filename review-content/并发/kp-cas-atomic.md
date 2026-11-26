---
id: kp-cas-atomic
type: knowledge
module: concurrent
title: CAS、原子类与 ABA
priority: P0
version: 2
requires: [kp-volatile-hb]
order: 35
---

## 一句话

CAS 是「若内存仍等于期望值则写入新值」的一条原子指令；原子类用它自旋更新。ABA 是值绕回原样 CAS 仍成功——对指针结构有害，对纯计数常无害。

## 组成与结构

| 类型 | 用途 | 笔记 |
|------|------|------|
| `AtomicInteger` 等 | 单变量计数/标志 | CAS + volatile 语义 |
| `AtomicReference` | 原子换引用 | 不保护对象内部 |
| `AtomicStampedReference` | 引用+版本戳 | 破 ABA |
| `LongAdder` | 高并发只加 | 分 cell，sum 非快照 |

三元组 (V, E, N)。CPU `cmpxchg` 在缓存锁/总线下完成比较+写。失败线程自旋，不是阻塞监视器。AQS `state`、CHM 桶头、无锁队列头尾都靠 CAS。

## 原理

**P0：成功路径。** 读到 E，`compareAndSet(E, N)` 成功 → 该地址一次原子写。

**P0：失败重试。** 其间别人改过 → false，再 `get` 再试。冲突高时空烧 CPU → 退化为锁或 `LongAdder`。

**P0：ABA。** A→B→A，CAS(A,C) 仍成功，不知中间动过。计数常无害；链表节点回收再分配同地址 → CAS 成功但拓扑错了 → 要用 `AtomicStampedReference` 单调戳记。

**P0：原子边界。** 单变量原子；`getAndUpdate` 内函数可执行多次须无副作用。两个原子变量无组合原子性，除非用 `AtomicReference` 包不可变快照一次 CAS。

**专家加分：与 hb。** `compareAndSet` 成功隐含 volatile 读写可见性。但「CAS 改 A 再 CAS 改 B」两步之间别人可见只改了一半。

**失败模式：** CAS 循环里做网络/副作用 → 重试重复下单。长临界区用 CAS 自旋 → CPU 打满。`weakCompareAndSet` 可能虚假失败，需重试；别与 plain 语义混为 volatile。

## 使用与实践

序号、开关、低冲突计数用原子类。高并发只加用 `LongAdder`，要瞬时值接受 `sum()` 非严格快照。

库存-下单用 DB 条件更新、锁或单线程队列，勿 CAS 包长业务。协程可用 `Atomic*`，但复合状态仍要 `Mutex` 或单线程 Dispatcher。

## 例子

```java
// 对：序号
final AtomicInteger seq = new AtomicInteger();
int ticket = seq.incrementAndGet();

// 对：带戳记摆动指针
return head.compareAndSet(expect, next, stamp, stamp + 1);
```

```java
// 错：只 CAS 一次，失败当错误
if (!counter.compareAndSet(old, old + 1)) throw new IllegalStateException();

// 错：update 里有副作用
counter.updateAndGet(n -> { log(n); return n + 1; }); // 重试多次 log

// 错：CAS 换引用却在旧对象上改字段
atomicRef.set(newState); // 别人仍改旧对象
```

ABA 口述：`AtomicInteger` 0→1→0，另一线程 `CAS(0,2)` 成功；换成节点地址即链表事故。

## 画面

```text
V=A  线程1 准备 CAS(A->C)
     线程2 A->B->A
线程1 CAS 成功（不知 B）  |  戳记 A@1 .. A@3 则失败须重读
```

## 常见坑与追问

1. **失败不重试。** 追问：一直失败？忙等占核，用锁或 LongAdder。
2. **更新函数有副作用。** 追问：JDK 为何强调无副作用？失败路径会再执行。
3. **AtomicReference + 可变对象。** 追问：不可变快照 CAS 与 volatile 发布？CAS 还能「仅当仍是旧引用才换」。
4. **ABA 答成两线程 A/B。** 追问：计数要戳吗？一般不要；指针结构要。
5. **LongAdder 当精确余额。** 错法：财务用 sum() 当事务余额。追问：何时够用？统计、监控，可接受近似。
