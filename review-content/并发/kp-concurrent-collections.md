---
id: kp-concurrent-collections
type: knowledge
module: concurrent
title: ConcurrentHashMap 与并发集合
priority: P0
version: 1
---

## 一句话

并发集合把锁粒度缩小或改成 CAS，保证单次操作原子；`ConcurrentHashMap` 的 `get`/`put` 是线程安全的，但「先 get 再 put」这种复合动作仍然不是。

## 组成与结构

先把三类容器分开，不要都叫成「加了锁的集合」：

| 种类 | 代表 | 并发时的行为 |
|------|------|----------------|
| 普通集合 | `HashMap`、`ArrayList` | 多线程写会丢数据、扩容出问题，迭代可能 `ConcurrentModificationException` |
| 同步包装 | `Collections.synchronizedMap`、`Hashtable` | 整表一把锁，方法互斥；迭代器仍要调用方自己拿同一把锁 |
| 并发集合 | `ConcurrentHashMap`、`ConcurrentLinkedQueue`、`CopyOnWriteArrayList` | 单操作有明确线程安全语义，迭代多为弱一致 |
| 阻塞队列 | `ArrayBlockingQueue`、`LinkedBlockingQueue` | 空则消费者等，满则生产者等，适合生产消费 |

JDK 8 的 `ConcurrentHashMap` 结构是：数组桶 + 链表，链表过长且表足够大时转红黑树。桶头用 volatile 读。第一个节点常用 CAS 放进去；冲突时对桶头节点 `synchronized`。扩容时多个线程可以帮忙搬迁，而不是整表锁死。它不允许 `null` 键和 `null` 值，避免「没有这个键」和「值就是 null」分不清。

`CopyOnWriteArrayList` 写时复制整份数组，读不加锁，适合监听器列表这种读远多于写的场景。写一次复制一次，数据大或写频繁就贵。

## 原理

1. **HashMap 为什么并发会坏。** `put` 要算下标、可能扩容、把节点插进链表或树。两条线程同时 `put`，可能都读到同一个空桶然后互相覆盖，一个键丢失。JDK 7 的头插在并发扩容时还可能把链表做成环，随后 `get` 死循环。JDK 8 改成尾插，环的经典故事少了，但丢更新和结构破坏还在。所以「升级到 JDK 8 就可以多线程用 HashMap」不成立。
2. **桶级互斥怎么做。** 线程对某个 key 操作时，只同步该桶的头节点，别的桶可以同时写。`get` 多数时候只做 volatile 读，不加同一把大锁，所以读多写多时比 `synchronizedMap` 扩得开。`size` 一类统计是近似求和（`LongAdder` 风格的计数），允许极短的不一致，不要拿它当精确事务计数。
3. **树化条件。** 链表长度超过 8 且数组长度不小于 64 才树化；数组还小就先扩容。树化是为了避免哈希很差时退化成线性查找，不是「一冲突就变树」。
4. **复合操作的洞。** `if (map.get(k) == null) map.put(k, v)` 两步之间别的线程可以插入。要原子就用 `putIfAbsent`、`compute`、`merge`。这些方法的 lambda 在桶锁内执行，里面不要再调同一张表的可能阻塞的方法，也不要做慢 IO。
5. **弱一致迭代。** 迭代器创建后别人继续 `put`，不会因为 modCount 对不上就抛异常。你可能看见新加进来的一部分，也可能看不见，不保证是某一瞬间的完整快照。要快照就在那时 `new HashMap<>(chm)` 拷一份，拷的过程仍可能和写入交错，只是拷完之后这份普通 Map 不再变。

阻塞队列的原理是锁或 CAS 加上条件等待：`put` 在容量满时等待 `notFull`，`take` 在空时等待 `notEmpty`。有界队列是天然背压。`ConcurrentLinkedQueue` 是无界、非阻塞的 CAS 队列，不会让生产者停下来，内存保护要靠别的手段。

## 使用与实践

缓存、去重集合、多线程汇总用 `ConcurrentHashMap`。监听器、广播用 `CopyOnWriteArrayList`，回调里记得处理「回调过程中又注册」的语义。生产消费用有界 `ArrayBlockingQueue`，和线程池的有界队列是同一思想。

Kotlin 的 `mutableMapOf` 就是普通 `LinkedHashMap`，多协程共用一样不安全。协程侧若要「多生产者单消费者」，优先 `Channel`，等待是挂起不是堵线程。已经在用 Java 库的上传队列，可以继续用阻塞队列，但不要在主线程 `take()`。

`synchronizedList` 的迭代必须：

```java
synchronized (list) {
    for (String s : list) { use(s); }
}
```

漏了这层，单次 `get` 虽然安全，迭代仍会失败或丢元素。

## 例子

```java
ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();

Session enter(String id) {
    return sessions.computeIfAbsent(id, key -> new Session(key));
}

boolean replaceState(String id, State expect, State next) {
    Session s = sessions.get(id);
    if (s == null) return false;
    return s.casState(expect, next); // 字段级再用原子类，不要 get 出来改完再 put 覆盖别人
}

BlockingQueue<Job> q = new ArrayBlockingQueue<>(100);
// 生产者 q.put(job);  消费者 job = q.take();
```

`computeIfAbsent` 保证同一个 id 只会创建一个 `Session`。若创建函数里又往这张表 `put` 别的键并形成环，可能死锁，JDK 文档明确禁止在映射函数里更新这张表的其他键时不加小心。

## 画面

```text
线程 A put(k1)          桶数组           线程 B put(k2)
    |                   [0] 锁桶0            |
    +-- 只锁 k1 所在桶 -> [1]               |
                        [2] <-- 只锁 k2 所在桶 --+

复合：get 看到空  ---- 别人 put 成功 ---- 你再 put 覆盖
要原子：一次 compute / putIfAbsent
```

## 常见坑与追问

1. **用 null 当哨兵。** `ConcurrentHashMap` 直接 NPE。追问：它为什么禁 null？无法区分「键不存在」和「值为 null」。
2. **检查再动作。** 追问：`putIfAbsent` 和 `compute` 怎么选？只有缺席才插入用前者；要看旧值再算新值用后者。
3. **在迭代里删除。** 普通 `HashMap` 要用迭代器的 `remove`。并发 Map 上 `remove(key)` 允许，但不要假设遍历到的集合等于开始时的全集。
4. **把 CopyOnWrite 当普通列表频繁 `add`。** 每次写复制数组，GC 压力大。追问：它的迭代器为什么不会抛并发修改？因为它遍历的是拿到的那份旧数组。
