---
id: kp-collections
type: knowledge
module: language
title: Java/Kotlin 集合选型
priority: P0
version: 3
order: 70
requires: [kp-equals-hashcode]
---

## 一句话

按要不要下标、要不要去重、要不要键值、会不会多线程写来选容器；Android 列表几乎总是 `ArrayList`，字典 `HashMap`，共享写用并发容器——给 `HashMap` 外面套 `synchronized` 不是面试能交卷的方案。

## 组成与结构

```text
  List / Set / Map（java.util）
  Kotlin 只读接口 vs Mutable*
  fail-fast 迭代 vs 弱一致并发迭代
  ArrayList 连续数组 vs LinkedList 链表
  HashMap 桶 + 链表/树
```

| 需求 | 选型 | 档位 |
|------|------|------|
| 下标、可重复 | `ArrayList` | P0 |
| 去重 | `HashSet` / `LinkedHashSet`（保序） | P0 |
| 键值 | `HashMap` / `LinkedHashMap`（LRU） | P0 |
| 键排序 | `TreeMap` | 专家加分 |
| 多线程写 Map | `ConcurrentHashMap` | P0 |
| 读多写少监听 | `CopyOnWriteArrayList` | 专家加分 |

`listOf` 真不可变；`mutableListOf` 当 `List` 传出只是编译期只读，运行时仍是 `ArrayList`。

## 原理

1. **ArrayList 扩容。** 满则新数组拷贝，均摊 O(1) append。预知 size 用初始 capacity，避免 RecyclerView 批量插入多次扩容。
2. **哈希桶与 key 契约。** 下标 `hash & (cap-1)`；key 的 equals/hash 必须稳定，放进 Map 后参与哈希字段不能变，否则 get/remove 失效。
3. **fail-fast。** 迭代中结构性修改（非迭代器 `remove`）→ `ConcurrentModificationException`。单线程误用检测，不是锁；多线程下可能不抛却丢数据。
4. **Kotlin 只读边界。** `List` 无 `add`，底层仍可变；Java 强转 `java.util.List` 可改。出站 `toList()` 或文档写清所有权。
5. **有序 ≠ 排序。** `LinkedHashMap` 保插入/访问序；`TreeMap` 按键序；`HashMap` 遍历无序——UI 勿依赖 HashMap 顺序。
6. **Sequence 惰性。** 大链、大源、少中间列表时用；小数据几次 `map` 用 `List` 更可读。

**并发与对比：** `Collections.synchronizedMap` 只锁整张表，迭代仍须外部同步；高写并发应 `ConcurrentHashMap`，读多写少广播列表才考虑 `CopyOnWriteArrayList`（写时全表复制）。`CHM.compute` 是单键原子读改写，不是两键事务。与数组：`IntArray` 等无装箱；UI 列表几乎总是 `ArrayList`，别用 `LinkedList` 当下标访问容器。给 `HashMap` 套 `synchronized` 不能替代 CHM 的细粒度语义，还会把整表锁成热点。

## 使用与实践

界面状态：`StateFlow` 发新 `List` 快照，就地改 `MutableList` 不换引用，Compose/LiveData 相等性可能不刷新。

去重 `distinctBy`/`HashSet`；计数 `groupingBy { }.eachCount()`。

协程批传递用不可变 list 或 Channel，不共享 `mutableListOf`。

## 例子

**正确**

```kotlin
val users = listOf(User(1, "a"), User(2, "b"))
val byId = users.associateBy { it.id }
val buffer = ArrayList<String>(64)
fun export(): List<String> = buffer.toList()
```

**错误对照：遍历时 `remove`**

```kotlin
val list = mutableListOf(1, 2, 3)
for (x in list) {
    if (x == 2) list.remove(x) // ConcurrentModificationException
}
```

**错误对照：可变 key 改哈希字段**

```kotlin
data class Key(var id: Int)
val map = hashMapOf(Key(1) to "a")
val k = Key(1)
map[k] = "a"
k.id = 2
map[k] // null，桶已对不上
```

**错误对照：StateFlow 就地改 list**

```kotlin
val _items = MutableStateFlow(mutableListOf(1))
_items.value.add(2) // 引用未变，collector 可能不收
_items.value = _items.value.toList() // 或 new list
```

## 画面

```text
下标可重复 → ArrayList
去重 → HashSet；要插入序 → LinkedHashSet
键值 → HashMap；键序 → TreeMap
多线程写 Map → ConcurrentHashMap
Kotlin List 只读：编译期；给 Java：拷贝
```

## 常见坑与追问

1. **LinkedList 随机访问快。** 追问：按下标为何慢？从头走到节点 O(n)。
2. **遍历时 add/remove。** 追问：异常名？`ConcurrentModificationException`。CHM 迭代为何不抛？弱一致快照语义。
3. **mutable 对象作 key 后改字段。** 追问：get 不到还能删吗？都难，key 用不可变 id。
4. **只读 List 出站给 Java。** 追问：会被改吗？能，若底层 mutable。`toList()`。
5. **HashMap 默认负载因子与树化。** 追问：链表过长为何要树？单桶 O(n) 退化，树化保 O(log n)（表够大时）。
