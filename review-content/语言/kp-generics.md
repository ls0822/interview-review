---
id: kp-generics
type: knowledge
module: language
title: 泛型与类型擦除
priority: P0
version: 1
---

## 一句话

泛型主要是编译期检查，进了 JVM 大部分类型参数会被擦掉；`List<String>` 和 `List<Int>` 在运行时都是 `List`，所以不能 `new T()`，也不能用 `instanceof` 直接问类型参数。

## 组成与结构

| 写法 | 能安全做的事 |
|------|----------------|
| `T` 不变 | 既能按 T 读，也能按 T 写，但父子泛型不兼容 |
| `? extends T` / Kotlin `out T` | 生产者，可以读出 T，不能随意写入 |
| `? super T` / Kotlin `in T` | 消费者，可以写入 T，读出来只能当 Any |
| 星投影 `*` | 不知道具体参数，只当未知 |

PECS：Producer Extends，Consumer Super。Kotlin 把声明处协变写在类型上：`interface Source<out T>` 表示这个接口只产出 T，于是 `Source<String>` 可以当成 `Source<Any>`。`in` 相反。

擦除之后，编译器在必要时插入强制转换。你从 `List<String>` 里 `get`，字节码里会 checkcast 成 String。原始类型 `List` 和未经检查的转换能把这个检查绕开，堆污染就从这里来：当时能塞进 Integer，等真正当成 String 用才炸。

## 原理

1. **为什么擦除。** Java 5 要兼容已经存在的字节码，泛型没有变成新的运行时类型，而是擦成上界，默认上界是 `Object`。`class Box<T extends Number>` 擦成 `Number`。所以重载不能只靠类型参数区分：`void f(List<String>)` 和 `void f(List<Int>)` 擦除后签名相同，编译不了。
2. **桥方法。** 父类 `Comparable<Animal>.compareTo(Animal)`，子类按 `compareTo(Dog)` 重写时，编译器会生成一个桥方法 `compareTo(Animal)` 再转调，保证多态槽位还在。面试提到「擦除后靠桥方法保住重写」即可。
3. **不能做的事。** `new T()`、`T.class`、`instanceof List<String>` 都不行，因为运行时没有 T。数组是协变且运行时带组件类型的，`new T[n]` 也不行。要用数组就传入 `Class<T>` 或用 `ArrayList`。
4. **通配符的方向。** `List<? extends Number>` 可以 `get` 出 `Number`，不能 `add(Integer)`，因为实际可能是 `List<Double>`。`List<? super Integer>` 可以 `add(Integer)`，`get` 只能当 `Object`。拷贝函数就是 `copy(src: List<out T>, dest: MutableList<in T>)`。
5. **Kotlin reified。** `inline fun <reified T> name()` 把函数体贴进调用点，调用点的 T 是具体类型，于是能写 `T::class`。这不是 JVM 保留了泛型，是内联之后检查发生在知道具体类型的地方。不能 `reified` 的普通函数依然被擦除。反射拿 Kotlin 的 `KType` 需要 `kotlin.reflect` 和类型令牌，和 reified 不是一条路。
6. **声明处和使用处。** Java 的通配符多在使用处：`List<? extends Animal>`。Kotlin 鼓励声明处 `out`/`in`，调用点更干净。给 Java 的 API 若把 `out` 暴露出去，Java 侧会看见通配符，签名变丑。公共 API 尽量用具体类型参数或简单上界。

## 使用与实践

集合一律带类型参数，禁止 raw type。和 Java 老接口交汇时，把未经检查的转换集中在一处边界，进去立刻变成 `List<User>`，不要让警告扩散到业务。

需要在运行时保留类型：要么 `inline reified`（适合找 serializer、启动 Activity 的小函数），要么显式传递 `Class` 或 `KClass`。不要在非 inline 函数里试图 `T::class.java`。

`MutableList<out T>` 这种写法通常是设计错误的信号：又要可变又要协变，写操作会被禁止。状态列表对外暴露 `List<T>`，对内用 `MutableList<T>`。

## 例子

```kotlin
fun <T> copy(from: List<T>, to: MutableList<in T>) {
    from.forEach { to += it }
}

inline fun <reified T> startsWith(): String = T::class.java.name

fun main() {
    val src = listOf("a", "b")
    val dest = mutableListOf<CharSequence>()
    copy(src, dest)          // String 产出，CharSequence 消费
    println(startsWith<String>())
}
```

```java
List<String> raw = new ArrayList<>();
List<?> erased = raw;           // 运行时都是 ArrayList
// new T() 不合法；要实例就传入 Class<T> 再 newInstance，且要有无参构造
```

## 画面

```text
源码 List<String>
   编译期：禁止 add(1)
   字节码：List + checkcast String
使用处：
   out / ? extends  只读出
   in  / ? super    只写入
reified + inline：调用点才知道 T
```

## 常见坑与追问

1. **运行时 `if (list is List<String>)`。** 追问：为什么不允许？擦除后没有 String 这个参数。只能判断 `is List<*>`。
2. **重载两个只差类型参数的方法。** 追问：擦除后签名怎样？一样，所以编译失败。改方法名。
3. **`MutableList<out T>` 不能 add。** 追问：PECS 怎么记？生产者用 extends/out，消费者用 super/in。
4. **reified 用在普通函数上。** 追问：为什么必须 inline？因为只有贴进调用点，具体类型才还在。接口方法不能 reified。
