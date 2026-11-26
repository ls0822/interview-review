---
id: kp-concurrent-collections
type: knowledge
module: concurrent
title: ConcurrentHashMap 与并发集合
priority: P0
version: 2
requires: [kp-cas-atomic, kp-synchronized-lock]
order: 60
---

## 一句话

并发集合保证**单次 API** 的原子语义；`ConcurrentHashMap` 的 `get`/`put` 线程安全，但「先 get 再 put」仍是非原子的复合动作——失败模式是丢更新、假快照和 `compute` 里再锁表死锁。

## 组成与结构

| 类别 | 代表 | 语义 |
|------|------|------|
| 普通 | `HashMap` | 并发写丢数据/坏结构 |
| 同步包装 | `Collections.synchronizedMap` | 方法互斥；迭代须外部同步 |
| 并发 | CHM、`ConcurrentLinkedQueue`、`CopyOnWriteArrayList` | 单操作定义清晰；弱一致迭代 |
| 阻塞队列 | `ArrayBlockingQueue` | 满/空阻塞，天然背压 |

JDK 8 CHM：桶数组 + 链表/红黑树；桶头 volatile 读；首插 CAS；冲突锁桶头 `synchronized`；协助扩容。禁 `null` 键值。

`CopyOnWriteArrayList`：写时复制，读无锁；监听列表读多写少。写频繁或大数组 → GC 压力。

## 原理

**P0：HashMap 并发坏因。** 同桶并发 `put` 覆盖丢失；JDK 7 头插+扩容可能成环；JDK 8 尾插减环故事但仍有竞争破坏。升级到 8 不等于可多线程 `HashMap`。

**P0：CHM 桶级锁 + CAS。** `get` 多为无锁 volatile 读；`size` 近似（LongAdder 风格），非事务计数。

**P0：复合洞。** `if (!map.containsKey(k)) map.put(k,v)` 两步间别人插入。原子：`putIfAbsent`、`compute`、`merge`——lambda 在桶锁内，勿再阻塞调同表或慢 IO。

**P0：弱一致迭代。** 不抛 `ConcurrentModificationException`；不保证某一瞬间全集快照。要快照：`new HashMap<>(chm)` 拷贝后本地不再变，拷贝过程仍可能与写交错。

**专家加分：树化。** 链长 >8 且 table≥64 才树化；表小先扩容。

**失败模式：** `computeIfAbsent` 映射函数里更新同表其它键 → 可能死锁（JDK 文档）。`synchronizedList` 迭代不外包 `synchronized` → 仍崩。COW 频繁写 → 复制风暴。

阻塞队列：`put`/`take` 与条件变量；有界即背压。`ConcurrentLinkedQueue` 无界非阻塞，内存要靠业务限速。

## 使用与实践

缓存/多线程汇总用 CHM；监听用 COW；生产消费用有界 `ArrayBlockingQueue`。Kotlin `mutableMapOf` 非线程安全；协程多生产者单消费者优先 `Channel`。主线程勿 `take()` 阻塞。

`synchronizedList` 遍历：

```java
synchronized (list) { for (var s : list) use(s); }
```

## 例子

```java
// 对
sessions.computeIfAbsent(id, Session::new);
return sessions.merge(key, 1, Integer::sum);
```

```java
// 错：检查再动作
if (map.get(k) == null) map.put(k, v); // 可丢键或双建

// 错：get 改字段再 put
Session s = map.get(id);
s.state = NEW; // 别人并发改
map.put(id, s); // 覆盖别人更新

// 错：computeIfAbsent 里 put 其它键进同表
map.computeIfAbsent(a, k -> { map.put(b, x); return v; });
```

字段级状态用会话内 `AtomicReference`/`casState`，勿整块 `put` 覆盖。

## 画面

```text
A put k1 锁桶 i    |    B put k2 锁桶 j  并行
复合 get 见空 -- 别人 put -- 你 put 覆盖 -> compute 一次做完
```

## 常见坑与追问

1. **null 哨兵。** CHM 禁 null。追问：为何？无法区分缺席与 null 值。
2. **`putIfAbsent` vs `compute`。** 前者仅缺席插入；后者读旧算新。
3. **迭代当快照。** 并发 `remove` 允许，但不等于开始时的全集。
4. **COW 当频繁写列表。** 追问：为何不抛 CME？迭代的是复制那一刻的数组引用。
5. **`volatile` List 字段。** 只保护引用切换，不保护 `ArrayList` 内部——须 CHM 或发布后不变。