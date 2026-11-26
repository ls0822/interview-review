---
id: kp-kotlin-jvm
type: knowledge
module: jvm
title: Kotlin 在 JVM/Android 上的字节码差异
priority: P0
version: 1
---

## 一句话

Kotlin 和 Java 走同一套加载、内存和内存模型；差别是编译器多生成 Companion、文件级 Kt 类、默认参数重载和挂起状态机，Android 上这些 class 再被打成 dex 交给 ART。

## 组成与结构

从源码到能跑，中间有三层，面试按层说，不要说成「Kotlin 有自己的堆」。

| 层 | 发生什么 |
|----|----------|
| 源码 | `.kt` / `.java` |
| 字节码 | kotlinc / javac 产出 `.class`。Kotlin 会合成额外类和方法 |
| Android | d8/r8 把 class 收成 dex，ART 加载。R8 会改名、内联、裁剪，所以运行时名字和调试器里看到的可能不同 |

常见合成物：

| 源码 | 字节码侧常见样子 |
|------|------------------|
| `class User` | `User` |
| `companion object` | `User$Companion`，字段 `Companion` |
| 文件顶层函数 | `UserKt` 里的静态方法 |
| `object Config` | 单例，`INSTANCE` 字段，初始化在 `<clinit>` |
| 默认参数 | 若不加 `@JvmOverloads`，Java 侧往往要传满，或走带默认掩码的合成方法 |
| Lambda | 匿名类，或 `invokedynamic` 拉起的 Lambda |
| `suspend fun` | 多一个 `Continuation` 参数，函数体变成状态机 |
| `data class` | 生成 `equals` / `hashCode` / `copy` / `componentN` |

类加载阶段仍然是加载、链接、初始化。`object` 的 `init` 在第一次主动使用时跑，不是 Application 一启动全跑完。

## 原理

1. **属性变成方法。** `var name: String` 在 JVM 上通常是私有字段加 `getName` / `setName`。Java 互操作、Moshi/Gson 反射、Bean 工具看的是这两个方法。`isReady` 这种布尔可能生成 `isReady()` 而不是 `getReady()`，和 Java Bean 约定不一致时要用 `@get:JvmName`。
2. **伴生对象不是 static。** `companion object` 是真正的嵌套类实例。Kotlin 里 `User.create()` 看起来像静态调用，Java 里默认是 `User.Companion.create()`。加上 `@JvmStatic` 才在 `User` 上生成真正的静态方法，并转调 Companion。`const val` 是编译期常量，可以内联到调用方，读取它不一定触发类初始化。`@JvmField` 把字段暴露成公开字段，少一层 getter。
3. **默认参数的掩码。** Kotlin 调用缺省参数时，编译器在调用点把默认值填上，或调用带有默认值位掩码的合成重载。Java 编译器不认识这套约定，所以看不到「少传几个参数」的重载，除非 `@JvmOverloads` 按参数从后往前生成多个普通重载。这就是混编里默认参数「失效」的字节码原因。
4. **suspend 的状态机。** 挂起函数编译后增加 `Continuation` 参数。函数被拆成 `label` 分段：第一次从开头执行，遇到挂起点就把局部变量塞进 Continuation，返回 `COROUTINE_SUSPENDED`；恢复时从 label 继续。所以它不是 Java 能直接 `new` 一个线程去调的普通方法。给 Java 的门面要写成回调或 `CompletableFuture`，在门面里再 `launch`。
5. **扩展函数没有多态。** `fun String.last()` 是 `StringsKt.last(this)` 这种静态方法，调用目标在编译期按静态类型定死。运行时对象是子类也不会分派到子类的扩展。成员方法优先于扩展。
6. **Android 上的额外一跳。** R8 可能把 Kt 类内联、改名。反射、Serializable、JS 桥、路由注解若依赖文件名类 `FooKt`，要 keep。`data class` 的字段名经混淆后，Gson 默认按字段名映射会失败，要用 `@SerializedName` 或 Kotlin 序列化。ART 的 JIT/AOT 对 Kotlin 没有另一套执行模型：热方法一样会被编译成本地代码，协程状态机就是普通方法加对象。

空安全在字节码里大多消失成普通引用，检查插入在调用点（显式的判空或断言）。平台类型因为 Java 没标注，编译器插不了严格检查，所以 NPE 会留到运行时。这和「Kotlin 不会 NPE」矛盾的根源在字节码边界，不在 ART。

## 使用与实践

对内 Kotlin、对外 Java 的 SDK：公开 API 上补 `@JvmStatic`、`@JvmOverloads`、`@Throws`、空注解，并用一个 Java 测试模块真调一遍。不要把核心能力只放在扩展函数和顶层函数里，Java 调用方只能看到静态方法，还依赖 `@file:JvmName` 才有稳定类名。

`internal` 不是 Java 的包私有。编译后名字可能被修饰，但仍可能被同进程的 Java 代码反射到。对外只暴露 public API。

看字节码用 Android Studio 的 Show Kotlin Bytecode，再 Decompile 成 Java。面试不用背指令，能指出 Companion、Continuation、默认参数重载三处即可。

## 例子

```kotlin
class User(val id: Int) {
    companion object {
        const val TAG = "U"
        @JvmStatic fun create() = User(1)
    }
}
fun topLevel() {}

class Api {
    @JvmOverloads fun load(id: Int, force: Boolean = false) {}
}
```

Java 侧对应关系：`User.create()` 因为有 `@JvmStatic`；`User.TAG` 当常量用；`UserKt.topLevel()` 调用顶层函数；`api.load(1)` 只有在 `@JvmOverloads` 时才存在。去掉注解，Java 就只能调用带全部参数的那个方法。

suspend 的 Java 形态可以记成：`Object load(Continuation<? super String> cont)`。返回 `COROUTINE_SUSPENDED` 表示还没完。

## 画面

```text
User.kt
  class User
  companion        -> User.class + User$Companion.class
  fun topLevel     -> UserKt.class 的静态方法
  suspend load     -> 多 Continuation，体是状态机
        |
        v
     d8/r8 -> dex -> ART 按普通类加载、初始化
```

## 常见坑与追问

1. **说 Kotlin 类加载和 Java 不同。** 追问：那不同在哪？不同在生成了哪些 class，加载阶段相同。`object` 仍是第一次主动使用才 `<clinit>`。
2. **Java 调默认参数编译不过。** 追问：字节码里其实有没有默认值？有，但在 Kotlin 的调用约定里。`@JvmOverloads` 才生成 Java 能用的重载。
3. **给 Java 暴露 suspend。** 追问：方法签名多了什么？`Continuation`。所以 SDK 用回调门面。
4. **混淆后 Gson 解析 data class 全是 null。** 追问：为什么 debug 好、release 坏？R8 改了字段名，反射对不上。要 keep 或注解声明序列化名。
