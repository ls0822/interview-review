---
id: kp-collections
type: knowledge
module: language
title: Java/Kotlin 集合选型
priority: P0
version: 1
---

## 一句话

按「要不要顺序、要不要去重、要不要键值、会不会多线程改」选容器；Android 业务列表默认 `ArrayList`，字典用 `HashMap`，多线程共享改用并发容器，而不是给 `HashMap` 碰运气。

## 组成与结构

```text
一串可重复、关心下标  -> List   -> ArrayList（几乎总是它）
不重复               -> Set    -> HashSet；要排序 TreeSet
键值                 -> Map    -> HashMap；要插入序 LinkedHashMap
多线程共享且会写     -> ConcurrentHashMap / 有界阻塞队列
读多写少的监听器     -> CopyOnWriteArrayList
```

Kotlin 把只读和可变拆开：`List` / `Map` / `Set` 接口没有写方法，`MutableList` 才有。这是编译期视图，不是运行时的不可变拷贝。`listOf` 得到的是真正不可变的实现；`mutableListOf` 再当成 `List` 传出去，Java 侧仍可能改到同一份。

`ArrayList` 是连续数组，按下标是 O(1)，尾部追加均摊 O(1)，中间插入要搬动元素。`LinkedList` 是双向链表，已知节点时改指针是 O(1)，但按下标找节点仍是 O(n)，缓存也不友好。Android 界面数据几乎都用 `ArrayList`。

`HashMap`：key 的 `hashCode` 决定桶，冲突挂链表，Java 8 起链表过长且表足够大时转红黑树，太满则扩容为 2 倍并重新分布。`TreeMap` 按比较器有序，操作是对数。`LinkedHashMap` 在哈希之上维持插入或访问顺序，适合做简单 LRU（重写 `removeEldestEntry`）。

## 原理

1. **数组扩容。** `ArrayList` 满了申请更大的数组并拷贝。预先知道大小时用 `ensureCapacity`，避免滚动列表里一次解析扩容多次。扩容是均摊，不是每次 `add` 都 O(n)。
2. **哈希分布。** 桶下标用哈希和容量（2 的幂）做位运算。`hashCode` 很差时所有键进同一个桶，树化之前查找退化为线性。所以作为 key 的类型必须稳定实现 `hashCode` 和 `equals`，且放进 Map 之后参与哈希的字段不能再改。
3. **fail-fast 迭代。** `ArrayList`、`HashMap` 的迭代器记下 `modCount`。遍历时用集合自己的 `remove` 而不是迭代器的 `remove`，计数对不上就抛 `ConcurrentModificationException`。这是单线程写坏迭代的检测，不是并发锁。多线程下它既可能抛，也可能不抛而悄悄丢数据，不能靠它当同步。
4. **Kotlin 只读的边界。** `fun take(items: List<String>)` 在 Kotlin 里不能 `add`。若这份 list 实际是 `ArrayList`，Java 方法收到后可以强制转换成 `java.util.List` 再 `add`。出站要么 `toList()` 拷贝，要么文档写明所有权仍在调用方且不可改。
5. **有序和排序不是一回事。** `LinkedHashMap` 保持插入顺序。`TreeMap` 按键排序。`HashMap` 不保证顺序。展示用的列表如果要稳定顺序，不要靠 `HashMap` 的遍历。

## 使用与实践

界面状态用 `List`，更新时整表换成新列表（尤其配合 `StateFlow` 和 `data class`），不要在旧列表上就地改完指望重组或 Diff 能看懂。需要就地改再用 `MutableList`，改完再发布一份快照。

去重用 `HashSet` 或 `distinctBy`。需要「按插入先来后到的去重」用 `LinkedHashSet`。计数用 `groupingBy { }.eachCount()`，不要手写容易写错的可变 Map，除非在热路径上。

跨线程：缓存用 `ConcurrentHashMap`；生产消费用有界队列。协程之间传递一批数据用 `Channel` 或不可变列表，不要共享 `mutableListOf`。

`Sequence` 是惰性的，适合长链过滤且源很大、希望少建中间列表。普通几次 `map`/`filter` 用 `List`，可读性更好，小数据不必上 `Sequence`。

## 例子

```kotlin
val users = listOf(User(1, "a"), User(2, "b")) // 只读
val byId: Map<Int, User> = users.associateBy { it.id }

val buffer = ArrayList<String>(64)
buffer += "x"

val unique = LinkedHashSet<String>()
unique.add("a")
unique.add("a")

// 出站给 Java 之前
fun snapshot(): List<String> = buffer.toList()
```

```java
Map<String, Session> cache = new ConcurrentHashMap<>();
cache.putIfAbsent(id, new Session(id));
```

中间插入很多、还要按下标随机访问时，也不要换成 `LinkedList`。先确认是不是真的在头部疯狂插入；多数 RecyclerView 数据不是这种负载。

## 画面

```text
要什么
  下标有序可重复 -> ArrayList
  去重不要求序   -> HashSet
  去重且插入序   -> LinkedHashSet
  键值           -> HashMap
  键有序         -> TreeMap
  多线程写 Map   -> ConcurrentHashMap
Kotlin List 只读只在编译期；给 Java 要拷贝
```

## 常见坑与追问

1. **LinkedList 随机访问更快这种口误。** 追问：按下标为什么仍慢？因为要从头走到那个节点。
2. **遍历时 add/remove。** 追问：异常叫什么？`ConcurrentModificationException`。并发 Map 的迭代为什么不抛？它是弱一致，不是 fail-fast。
3. **把可变对象当 HashMap 的 key，之后改了字段。** 追问：会怎样？桶对不上，get 不到，也删不掉。key 用不可变类型或 `id`。
4. **MutableList 当 StateFlow 的值就地修改。** 追问：为什么界面不刷新？引用没变，等于判断认为状态没变。要给一个新列表。
