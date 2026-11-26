---
id: kp-cas-atomic
type: knowledge
module: concurrent
title: CAS、原子类与 ABA
priority: P0
version: 1
---

## 一句话

CAS 是一条「读到的值若仍等于期望值，就改成新值」的原子指令；原子类用它做自旋更新。ABA 是值绕回原样，CAS 却以为没人动过。

## 组成与结构

`java.util.concurrent.atomic` 里常用的是三类：

| 类型 | 干什么 | 底层 |
|------|--------|------|
| `AtomicInteger` / `AtomicLong` / `AtomicBoolean` | 单个数值或标志 | `Unsafe.compareAndSwap` 或 `VarHandle` |
| `AtomicReference<T>` | 原子替换引用 | 同上 |
| `AtomicStampedReference` / `AtomicMarkableReference` | 引用加版本号或标记 | 一次改一对值 |
| `LongAdder` | 高并发计数 | 分段累加，读时汇总 |

CAS 的三个操作数是：内存地址 V、期望值 E、新值 N。CPU 的 `cmpxchg`（或等价指令）在锁总线或缓存锁的前提下完成比较和写入，中间不会插入别的写。Java 侧看不到锁对象，所以叫无锁；失败的线程通常自己循环再读再试，这叫自旋，不是阻塞在监视器上。

AQS 的 `state`、`ConcurrentHashMap` 桶头的首次插入、无锁队列的头尾指针，都是 CAS。锁的「轻量级」阶段本身也是 CAS。

## 原理

1. **一次成功的路径。** 线程读到 `n == 0`，计算新值 1，调用 `compareAndSet(0, 1)`。若此刻内存仍是 0，写入 1 并返回 true。这一步对这个地址是原子的，别的线程不会看到「比到一半」。
2. **失败重试。** 若在读和 CAS 之间别人已经写成 1，这次 CAS 返回 false，循环再 `get()`。`incrementAndGet` 就是这个循环，并在失败时可以调用 `onSpinWait` 让出执行资源提示。自旋在冲突少、临界区只有一个字时很便宜；冲突高或临界区逻辑长，会空烧 CPU，这时锁或 `LongAdder` 更合适。
3. **ABA。** 线程 1 读到 A，准备把 A 换成 C。线程 2 把 A 改成 B 又改回 A。线程 1 的 `CAS(A, C)` 成功，它无法从值上发现中间发生过变化。数值计数器上 ABA 常常无害，因为你只关心当前数是不是还是那个数。链表指针上有害：节点被摘掉、回收、又被分配到同一地址挂回队列，指针的比特相同，结构已经不是原来那条链，CAS 会把错误的后继写回去。
4. **版本号如何破 ABA。** `AtomicStampedReference` 把引用和 int 戳记绑在一次 CAS 里。线程 1 读到 `(ref=A, stamp=1)`，线程 2 改出改回时 stamp 变成 3，线程 1 再 `compareAndSet(A, C, 1, 2)` 会失败。戳记要单调变化，不要只在 0/1 两个标记上来回翻，否则标记本身也会 ABA。
5. **原子类保证到哪。** `get` / `set` / `compareAndSet` / `incrementAndGet` 对这一个变量是原子的，`set` 还有 volatile 语义。`getAndUpdate(prev -> 复杂函数)` 里的函数可能执行多次，必须没有副作用。两个原子变量之间没有组合原子性：先改余额再改流水，中间仍能被别人看见只改了一半。

`weakCompareAndSet` 在旧 API 里可能虚假失败，新代码用 `compareAndSet` 或 `weakCompareAndSetPlain/Volatile` 这类明确内存序的 `VarHandle` 方法。面试说「CAS 失败就重试」即可，不必展开每个内存序名字，但要知道 plain 不等于 volatile。

## 使用与实践

计数、序号、一次性开关（`compareAndSet(false, true)` 只让一个线程赢）用原子类。高并发只加不读的统计用 `LongAdder`，它把冲突拆到多个 cell，降低同一个缓存行的乒乓；需要精确瞬时值时再 `sum()`，求和本身不是一个原子快照。

不要用 CAS 包住一长段业务：循环里做网络请求，失败就整段重来，既慢又可能重复副作用。那种「检查库存再下单」要用锁、数据库条件更新，或单线程队列串行化。

Kotlin 没有另一套 CPU 原子指令。`kotlinx.atomicfu` 是封装；协程共享状态更常见的是 `Mutex` 或把状态收进单线程调度器。`AtomicInteger` 可以在协程里用，因为它不阻塞线程，但别在挂起前后假设复合逻辑仍原子。

## 例子

```java
final AtomicInteger seq = new AtomicInteger();
int ticket = seq.incrementAndGet(); // 内部 CAS 循环

final AtomicStampedReference<Node> head =
        new AtomicStampedReference<>(new Node(0), 0);

boolean swing(Node expect, Node next) {
    int[] stamp = new int[1];
    Node cur = head.get(stamp);
    if (cur != expect) return false;
    return head.compareAndSet(expect, next, stamp[0], stamp[0] + 1);
}
```

ABA 的数值演示可以口述：`AtomicInteger` 从 0 变 1 再变回 0，另一线程 `compareAndSet(0, 2)` 仍会成功。把这个 0 换成链表节点地址，就是事故现场。

## 画面

```text
内存 V
线程1 读到 E=A                线程2
  |                           A -> B -> A
  |-- CAS(V, E=A, N=C) -----> 值仍是 A，成功
  它不知道中间有过 B

带戳记：A@1 -> B@2 -> A@3
线程1 拿着戳记 1 去 CAS，失败，必须重读
```

## 常见坑与追问

1. **CAS 失败不重试，只试一次。** 并发下一次失败是常态，不是错误。追问：一直失败会怎样？忙等占满核。可退化为锁，或 `LongAdder` 分片。
2. **更新函数有副作用。** `updateAndGet` 里 `list.add` 会在重试时加多次。追问：为什么 JDK 文档强调函数要无副作用？因为失败路径会再算一遍。
3. **用 `AtomicReference` 换根对象却在旧对象上改字段。** CAS 只保证引用切换原子，不保证对象内部。追问：不可变对象加 CAS 换引用，和 volatile 发布差在哪？CAS 还能表达「仅当还是旧引用才换」。
4. **把 ABA 答成「A 和 B 两个线程」。** 名字是值从 A 变到 B 再变回 A。追问：计数器要不要上版本号？一般不要；指针结构才要。
