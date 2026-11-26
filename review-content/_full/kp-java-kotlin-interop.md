---
id: kp-java-kotlin-interop
type: knowledge
module: language
title: Java 与 Kotlin 混编互操作
priority: P0
version: 2
order: 110
requires: [kp-null-safety, kp-extensions-hof, kp-annotations-exceptions, kp-collections]
---

## 一句话

混编守住五道缝：平台类型与空注解、`JvmStatic`/`JvmOverloads`/`Throws`、扩展只是静态方法、`suspend` 不对 Java 直出、Kotlin 只读集合出站仍可能被 Java `add`——字节码是一套，差异全在「一边编译器知道、另一边不知道」。

## 组成与结构

```text
  Kotlin First（对内）──门面──> Java 稳定 API（对外）
  平台类型 T!
  默认参数 / companion / object
  只读 List ≠ 运行时不可变
  suspend + Continuation
```

| Kotlin | Java 默认 | 补丁 |
|--------|-----------|------|
| `String?` / 无注 Java | `T!` | `@Nullable` `@NonNull` |
| 默认参数 | 仅全参 | `@JvmOverloads` |
| companion 方法 | `Companion.foo` | `@JvmStatic` |
| 顶层/扩展 | `FooKt.ext(r)` | `@file:JvmName` / 真 static |
| 受检异常 | Kotlin 不强制 | `@Throws` |
| `suspend` | +Continuation | 回调/Future 门面 |
| `List` | `java.util.List` | 出站 `toList()` |
| `internal` | 仍 public 字节码 | 不当包私有 |

`@get:JvmName`、`@JvmField`、关键字冲突改名。

## 原理

1. **空安全在边界断开。** Java 可传 null 进 Kotlin `String`；Kotlin 可把 Java 无注返回当非空用。注解是双方唯一静态契约，须标在调用方看见的声明上。
2. **默认参数≠重载。** Kotlin 用 bitmask；javac 不见少参方法。`@JvmOverloads` 从尾往前生成重载，或 Builder。
3. **Companion 不是 static。** `@JvmStatic` 再生成外观静态转调；`const val` 编译期常量；`@JvmField` 暴露字段—可变慎公开。
4. **异常检查不对称。** Kotlin 调 Java IOException 可不 try；Java 调 Kotlin 无 `@Throws` 不强制 catch——SDK 文档要写清失败模型。
5. **只读集合假象。** 底层常是 `ArrayList`；Java `add` 会改共享堆。进站/出站拷贝或 immutable 实现，写所有权。
6. **suspend 签名。** 编译后多 `Continuation`，可能返回 `COROUTINE_SUSPENDED`。Java 门面 `launch`+`Consumer`/`CompletableFuture`，不要把状态机当 API。

`internal` 字节码 public+修饰名，不是 Java package-private。`Unit`/`Nothing`/value class 对 Java 签名不友好——对外用普通 Java 类型。

## 使用与实践

建纯 Java 测试 module 真调：默认参数、静态、受检异常、改返回 List。

Review：`!!`、public `suspend`、返回内部 `mutableList`、Companion 忘 `JvmStatic`、Java API 无空注解。

Data class 序列化名+混淆 keep。老 Java 不必全盘 Kotlin，边界收口即可。

## 例子

**正确：门面**

```kotlin
class Users {
    companion object {
        @JvmStatic fun create(id: String) = Users()
    }
    @JvmOverloads fun load(id: String, force: Boolean = false) {}
    @Throws(java.io.IOException::class)
    fun read(): String = error("io")
}
fun snapshot(src: MutableList<String>): List<String> = src.toList()
```

```java
Users.create("1");
new Users().load("1");
try { new Users().read(); } catch (IOException e) { }
List<String> copy = snapshot(mutable); // Java 改 copy 不动内部 buffer
```

**错误对照：public suspend**

```kotlin
// Java 可见签名类似：Object load(Continuation<? super String>)
suspend fun load(): String = repo.load()
```

**错误对照：List 直出内部 mutable**

```kotlin
private val items = mutableListOf("a")
fun items(): List<String> = items // Java: getItems().add("x") 改掉 Kotlin 状态
```

**错误对照：默认参数无 Overloads**

```kotlin
class Api {
    fun fetch(id: String, timeoutMs: Long = 5000) {}
}
// javac: 必须传 timeoutMs
```

## 画面

```text
对内：suspend、sealed、扩展、默认参
        │ 门面 + 注解 + 拷贝
对外：static、重载、空注、回调/Future
        │ 纯 Java 模块回归
```

## 常见坑与追问

1. **@Nullable 仍 `!`。** 追问：标在实现没标接口？调用方编译看声明；包名须 JetBrains/AndroidX。
2. **Java 找不到少参方法。** 追问：字节码有少参重载吗？无 `@JvmOverloads` 就没有。
3. **宿主改了返回的 List。** 追问：只读为何挡不住？挡 Kotlin 编译器，不挡 JVM。
4. **public suspend 给 Java。** 追问：多了啥？`Continuation`。改回调/Future。
5. **拿 internal 当隐藏 API。** 追问：Java 能调吗？同模块字节码 public；跨模块靠模块图不是关键字。