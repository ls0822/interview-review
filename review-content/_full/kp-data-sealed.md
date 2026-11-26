---
id: kp-data-sealed
type: knowledge
module: language
title: data class、sealed、object 与 enum
priority: P0
version: 1
---

## 一句话

`data class` 用来装一份会比较、会拷贝的数据；`sealed class` 用来表示有限几种形状不同的结果；`object` 是单例；`enum` 是结构相同的有限常量。

## 组成与结构

| 类型 | 编译器多给你的 | 不要拿它做的事 |
|------|----------------|----------------|
| `data class` | `equals`/`hashCode`/`toString`/`copy`/`componentN`，主构造里的属性才参与 | 可变全局缓存、需要继承体系 |
| `sealed class` | 子类集合封闭，同模块内 `when` 可穷尽 | 无限开放的插件类型 |
| `object` | 线程安全的懒加载单例，`INSTANCE` | 当成普通可复制的数据 |
| `companion object` | 类名下的命名空间，不是自动的 Java static | 不加重注解就当静态方法给 Java |
| `enum class` | 每个常量一个实例，可带统一字段 | 每个分支挂完全不同的数据结构 |

`data class` 的主构造参数必须是 `val` 或 `var`。类体里另写的属性不进 `equals`。它默认 `final`，不能当开放父类（有限的接口实现可以）。

`sealed` 的直接子类必须在同一模块，新版本 Kotlin 可以放在同一模块的其他文件。子类可以是 `object`、`data class` 或普通类。

## 原理

1. **data 的相等。** 生成的 `equals` 按主构造属性逐个比较，`hashCode` 用同一批属性。两个 `User(1,"a")` 值相等但不是同一个引用。放进 `HashSet` 之后如果把 `var` 属性改了，桶会错位。所以作为状态和 Map key 的 data class 用 `val`。
2. **copy 是浅拷贝。** `user.copy(name = "b")` 得到新的 `User`，嵌套的 list 若仍是同一个引用，改 list 内容两个对象都看见。要发布给 `StateFlow` 的嵌套集合，需要换新列表，而不是只 copy 外层。
3. **sealed 穷尽。** `when` 不写 `else` 时，编译器按已知子类检查是否写全。以后加一种 `Error`，所有不写 `else` 的 when 都会编译失败，这是它相对「整数错误码 + else」的价值。运行时没有额外的「密封检查指令」，封闭性来自编译器禁止模块外继承。
4. **和 enum 的分界。** 枚举常量在类加载时就各有一个实例，可以有字段，但每个常量的字段结构相同。`Success(list)` 需要无数个不同 list 的实例，枚举做不到。方向、模式、权限这种固定名字用枚举；界面状态、网络结果用 sealed。
5. **object 的初始化。** `object` 编译成带 `INSTANCE` 的类，初始化锁在类初始化上，第一次主动使用才跑 `init`，由 JVM 保证只跑一次。它不是懒到「第一次调用某方法」，而是第一次触发该类初始化的任何主动使用。`companion object` 也是这样一个实例，挂在外部类的 `Companion` 字段上。
6. **密封接口。** `sealed interface` 适合一个类型同时属于多种能力，仍然保持穷尽。UI 事件用 sealed interface，状态用 sealed class 持有数据，都可以。不要为了穷尽把几十种子类塞进一个密封层次，那会变成上帝类型。

## 使用与实践

界面状态：

```kotlin
sealed interface UiState {
    data object Loading : UiState
    data class Ok(val items: List<Item>) : UiState
    data class Err(val msg: String) : UiState
}
```

`data object` 让没有数据的分支也有稳定的 `equals`/`toString`，比普通 `object` 在日志里更好认。一次性事件不要塞进这个状态再靠「相同值不刷新」去重，否则旋转后 StateFlow 会把旧错误再交给新界面。事件用单独通道，或在状态里放 `pending` 并在消费后清掉。

枚举适合网络协议里稳定的模式字符串，配 `@SerializedName`。不要用枚举装「成功带列表、失败带错误码」这种异构数据。

## 例子

```kotlin
enum class Direction { NORTH, SOUTH, EAST, WEST }

enum class Color(val rgb: Int) { RED(0xFF0000), GREEN(0x00FF00) }

sealed class Result {
    data class Ok(val body: String) : Result()
    data class Err(val code: Int, val msg: String) : Result()
}

fun render(r: Result): String = when (r) {
    is Result.Ok -> r.body
    is Result.Err -> "${r.code}:${r.msg}"
}

object Clock {
    fun now(): Long = System.currentTimeMillis()
}
```

`Ok("a") == Ok("a")` 为 true。`Color.RED.rgb` 每个常量都有同一形状的字段。`Clock` 没有构造，全进程一个实例。

## 画面

```text
enum：固定几个实例，字段形状一样
sealed：有限个子类，每个子类字段可以完全不同
data class：值相等 + copy
object：INSTANCE，类初始化时创建
```

## 常见坑与追问

1. **data class 用 var，放进 HashSet 再修改。** 追问：为什么找不到了？hashCode 变了，不在原来的桶。
2. **when 写了 else，加密封子类也不报错。** 追问：穷尽检查靠什么？靠不写 else。else 会把新分支吞掉。
3. **用枚举表示 UI 状态，成功时还要另挂一个可变列表。** 追问：为什么别扭？枚举实例是单例，列表会在所有使用方之间共享。改成 sealed。
4. **把 object 当成进程启动就初始化。** 追问：什么时候跑 init？第一次主动使用该类时。没人访问就不会跑。
