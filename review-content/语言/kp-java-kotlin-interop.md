---
id: kp-java-kotlin-interop
type: knowledge
module: language
title: Java 与 Kotlin 混编互操作
priority: P0
version: 1
---

## 一句话

混编要守住五件事：平台类型和空注解、`@JvmStatic` / `@JvmOverloads` / `@Throws`、扩展只是静态方法、`suspend` 不对 Java 直出、只读集合出站可能被 Java 改掉。

## 组成与结构

对内可以 Kotlin First，对宿主和 toB SDK 的稳定门面要让 Java 能直接调用。字节码仍是一套，坑都出在「Kotlin 编译器知道、Java 编译器不知道」的约定上。

| Kotlin 特性 | Java 侧默认看到的 | 补什么 |
|-------------|-------------------|--------|
| 可空类型 | 没有注解时变成平台类型反过来也一样 | `@Nullable` `@NonNull` |
| 默认参数 | 往往只有全参数方法 | `@JvmOverloads` |
| companion 方法 | `Foo.Companion.bar()` | `@JvmStatic` |
| `object` | `Foo.INSTANCE` | 调用点写 INSTANCE |
| 顶层 / 扩展 | `FileKt.fun(receiver)` | `@file:JvmName`，核心改成成员 |
| 受检异常 | Kotlin 不强制 | 给 Java 的 API 加 `@Throws` |
| `suspend` | 多一个 Continuation | 回调或 Future 门面 |
| `List` 只读 | 仍是 java.util.List | 出站拷贝 |
| `internal` | 不是包私有，名字可能被修饰但仍可能看见 | 不当成封装边界 |

属性会变成 `getX`/`setX` 或 `isX`。和 Bean、反射序列化对不上时用 `@get:JvmName`。关键字冲突用 `@JvmName` 改字节码名。

## 原理

1. **空安全在边界断开。** Kotlin 的 `String?` 不会让 Java 编译器拒绝传入 null。Java 的未注解返回值也不会让 Kotlin 拒绝当非空用。注解是双方唯一的静态契约。注解必须出现在 Java 调用方能看见的那个方法上（接口、抽象方法），只标实现类不够。
2. **默认参数不是重载。** Kotlin 用调用约定和默认值掩码表达「可以少传」。javac 不生成这些调用，所以必须由 `@JvmOverloads` 从最后一个参数开始往前做成真正的重载，或手写 Builder。构造函数同样。
3. **静态方法要额外生成。** Companion 是实例。`@JvmStatic` 在外部类上再生成一个静态方法转过去。`const val` 可以被 Java 当编译期常量。`@JvmField` 暴露字段，可变字段不要这样公开。
4. **异常检查是编译器功能。** Kotlin 调用 Java 的 `IOException` 可以不写 try，失败仍然会发生。反过来，Java 调用 Kotlin 时，没有 `@Throws` 就不必 catch，调用方会忽略受检异常。SDK 更稳的做法是错误码或 `Result`，异常只留给真正意外的故障。
5. **集合的只读是假的运行时约束。** Kotlin `List` 没有写方法，底层经常就是 `ArrayList`。Java 拿到引用后可以 `add`。若这份列表同时还在 Kotlin 里当不可变状态用，就会被外部改掉。进站立刻 `toList()`，出站给防御性拷贝或不可变实现，并写清谁拥有它。
6. **suspend 的调用约定。** 编译后的方法需要 `Continuation`，返回值可能是 `COROUTINE_SUSPENDED`。Java 没有挂起语法，硬调会把状态机暴露出去。门面里自己 `scope.launch`，对 Java 提供 `void load(Callback)` 或 `CompletableFuture<T>`。

`internal` 在字节码里仍是 public，再把名字改成带模块后缀的形式来减少误用。同模块外的 Java 若反射或依赖了这个名字，混淆和多模块拆分时会断。不要把 internal 当成 Java 的 package-private。

`Unit` 在 Java 里可能变成返回 `Unit` 实例或 void，视注解和版本而定；`Nothing` 更不适合出现在 Java 签名里。value class 对 Java 有装箱限制。这些都让「对外签名保持 Java 能读懂的普通类型」成为纪律。

## 使用与实践

做一个只含 Java 的测试模块，依赖对外 API，编译并调用：空参数、少一个默认参数、静态方法、抛受检异常、对返回的 List 执行 add。这一层比口头约定更能抓住回归。

Review 清单：平台类型、`!!`、suspend 出现在 public、只读集合直接返回内部 mutable、companion 忘了 `JvmStatic`、给 Java 的异常没 `@Throws`。

序列化模型若是 data class，给字段加稳定的序列化名，R8 keep 规则写上。混淆后 Java 反射找不到 Kotlin 属性是发布才出现的问题。

新代码继续写 Kotlin。老 Java 不必为了混编一次改完，在边界收口即可。

## 例子

```kotlin
class Users {
    companion object {
        @JvmStatic
        fun create(id: String): Users = Users()
    }
    @JvmOverloads
    fun load(id: String, force: Boolean = false) {}
    @Throws(java.io.IOException::class)
    fun read(): String = error("io")
}

fun snapshot(src: MutableList<String>): List<String> = src.toList()
```

```java
Users.create("1");          // 依赖 JvmStatic
new Users().load("1");      // 依赖 JvmOverloads
try {
    new Users().read();
} catch (java.io.IOException e) {
    // 依赖 Throws，否则 Java 不要求 catch
}
```

对 Java 隐藏协程：

```kotlin
fun loadAsync(cb: java.util.function.Consumer<String>) {
    scope.launch {
        val text = repo.load() // suspend 留在内部
        cb.accept(text)
    }
}
```

## 画面

```text
对内 Kotlin：suspend、默认参数、扩展、sealed
        | 门面
对外 Java：静态方法、重载、空注解、回调/Future、不可变拷贝
        | Java 测试模块真调一遍
```

## 常见坑与追问

1. **加了 @Nullable 仍显示平台类型。** 追问：标在哪了？必须标在调用方编译时看见的方法上，包名还得是 Kotlin 认识的。
2. **Java 调默认参数报「找不到方法」。** 追问：字节码里有没有少参重载？没有 `@JvmOverloads` 就没有。
3. **把 List 返回给宿主后内容变了。** 追问：只读为什么挡不住？挡的是 Kotlin 编译器，不是 JVM。出站要拷贝。
4. **public suspend 让 Java 接入。** 追问：签名多了什么参数？`Continuation`。门面改成回调。
