---
id: kp-generics
type: knowledge
module: language
title: 泛型与类型擦除
priority: P0
version: 2
order: 80
requires: [kp-collections, kp-oop-basics]
---

## 一句话

泛型主要是编译期检查，进 JVM 后类型参数大多被擦掉——`List<String>` 与 `List<Int>` 运行时都是 `List`，所以不能 `new T()`、不能 `instanceof List<String>`；协变/逆变规则决定「能读还是能写」。

## 组成与结构

```text
  T 不变
  ? extends T / out T   生产者，偏读
  ? super T / in T      消费者，偏写
  * 星投影              未知参数
  擦除 → 上界 Object/Number + checkcast
  桥方法               保住擦除后的重写
  reified + inline      调用点才知道 T
```

PECS：Producer Extends，Consumer Super。Kotlin 声明处 `interface Source<out T>`、`MutableList<in T>`。

## 原理

1. **为何擦除。** Java 5 兼容旧字节码；泛型非运行时类型。`List<String>`/`List<Integer>` 不能重载共存——擦除后签名相同。
2. **桥方法。** 子类 `compareTo(Dog)` 与父 `compareTo(Animal)` 擦除冲突，编译器合成 `compareTo(Object)` 桥转发。
3. **不能做的事。** `new T()`、`T.class`、`is List<String>`；数组协变但 `new T[n]` 也不行。实例化传 `Class<T>` 或 `ArrayList`。
4. **通配符方向。** `List<out Number>` 读为 `Number`，不能 `add(Int)`（实际可能是 `List<Double>`）。`List<in Int>` 可 `add(Int)`，`get` 只能当 `Any?`。
5. **reified 不是保留泛型。** inline 把调用点展开，`T::class` 在调用点替换具体类。普通函数、接口抽象方法不能 reified。
6. **声明处 vs 使用处。** Java 通配符在使用处；Kotlin 倾向声明处 `out`/`in`。对 Java 暴露的 `out` API 会变成丑陋通配符签名。

## 使用与实践

禁止 raw type；与 Java 老 API 交汇时 unchecked 转换收在边界一层，进去立刻变成具体类型。

运行时要类型：`inline reified`（小工具）或显式 `KClass`/`Class`。`MutableList<out T>` 常是 API 设计异味——可变就不要协变 out。

## 例子

**正确：copy 生产者/消费者**

```kotlin
fun <T> copy(from: List<T>, to: MutableList<in T>) {
    from.forEach { to += it }
}
inline fun <reified T> firstOf(list: List<*>): T? {
    for (e in list) if (e is T) return e
    return null
}
```

**错误对照：运行时测类型参数**

```kotlin
fun check(list: Any) {
    if (list is List<String>) { } // 编译错误：不能 is 带参数化类型
}
```

**错误对照：擦除后堆污染**

```java
List raw = new ArrayList();
raw.add(1);
String s = (String) raw.get(0); // 运行 ClassCastException，编译时可能仅 unchecked 警告
```

**错误对照：`MutableList<out T>` 还想 add**

```kotlin
fun broken(box: MutableList<out Number>) {
    box.add(1) // 编译失败：不能把 Number 子类型写进 out 列表
}
```

## 画面

```text
源码 List<String>
  编译：禁止 add(1)
  字节码：List + get 后 checkcast String
out/extends：只读出
in/super：只写入
reified+inline：调用点才有具体 T
```

## 常见坑与追问

1. **`is List<String>`。** 追问：为何不行？擦除后无 String 参数；`is List<*>` 可以。
2. **双泛型重载。** 追问：擦除后？签名相同，编译失败。
3. **`MutableList<out T>` 不能 add。** 追问：PECS 怎么记？生产者 extends/out，消费者 super/in。
4. **reified 放非 inline。** 追问：为何必须 inline？类型信息只在调用点残留。
5. **Java 数组协变 vs 泛型不变。** 追问：`List<Object>` 能赋 `List<String>` 吗？不能；数组可以协变但有运行插入风险。