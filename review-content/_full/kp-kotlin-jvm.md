---
id: kp-kotlin-jvm
type: knowledge
module: jvm
title: Kotlin 在 JVM/Android 上的字节码差异
priority: P0
version: 2
requires: [kp-classloader, kp-jvm-memory]
order: 50
---

## 一句话

Kotlin 与 Java 共享加载、堆与 JMM；差异在编译器**多生了哪些类和方法**——Companion、`FooKt`、默认参数掩码、`suspend` 状态机——再经 d8/r8 进 dex，ART 仍按普通类初始化，没有第二套「Kotlin 堆」。

## 组成与结构

三层流水线：

| 层 | 产物 |
|----|------|
| 源码 | `.kt` / `.java` |
| 字节码 | `.class`（Kotlin 合成类更多） |
| Android | dex（R8 内联/改名/裁剪） |

常见合成对照（P0 必背）：

| 源码 | 字节码侧 |
|------|----------|
| `companion object` | `User$Companion` + 外部类 `Companion` 字段 |
| 顶层函数 | `FileNameKt` 静态方法 |
| `object Config` | 单例 `INSTANCE`，`<clinit>` 懒初始化 |
| 默认参数 | 掩码重载；Java 侧需 `@JvmOverloads` |
| `suspend` | 隐式 `Continuation` 参数 + label 状态机 |
| `data class` | `equals/hashCode/copy/componentN` |
| `inline class` / `value class` | 擦除为包装或内联（版本相关，面试知道「运行时多为装箱或原语包装」） |

专家加分：`@JvmDefaultWithoutCompatibility` / `-Xjvm-default` 控制接口默认方法在字节码里是 `default` 还是合成 `DefaultImpls`；混淆后反射找方法签名会变。

## 原理

1. **属性 → 访问器。** `var name` 私有字段 + `getName`/`setName`。JavaBean、Gson 反射看方法名；`isReady` 可能 `isReady()` 不是 `getReady()`，用 `@get:JvmName` 对齐。
2. **Companion 非 Java static。** 真正嵌套类实例；Java 默认 `User.Companion.create()`。`@JvmStatic` 才在外类生成静态转发。`const val` 编译期内联；`@JvmField` 暴露裸字段，跳过 getter。
3. **默认参数与 Java 互操作。** Kotlin 调用点填默认或用位掩码合成方法；javac 不认，故 Java 只有 `@JvmOverloads` 生成的重载或必须传满。错以为 Kotlin 默认参数对 Java 透明是混编 bug 主因。
4. **suspend 状态机。** 编译器拆 label 段，挂起时局部变量进 `Continuation`，返回 `COROUTINE_SUSPENDED`；恢复从 label 继续。Java 不能直接当普通方法调——门面用回调/`CompletableFuture`/`runBlocking`（仅边界）包一层。
5. **扩展函数静态分派。** `fun String.foo()` → `XxxKt.foo(receiver)`，按**静态类型**绑定，无多态；成员优于扩展。
6. **Android R8 额外一跳。** 内联/改名使 `FooKt`、泛型签名、keep 规则失效；`data class` + Gson 字段名混淆 → release 全 null。ART JIT 仍编译热方法；协程状态机就是普通类方法。

空安全多在调用点插检查；**平台类型**（Java 未标注）不插严格检查，NPE 留运行时——「Kotlin 消灭 NPE」在 Java 边界上不成立。

## 使用与实践

对外 SDK：`@JvmStatic`、`@JvmOverloads`、`@Throws`、空安全注解，加 Java 测试模块真调。核心 API 别只放顶层/扩展里藏类名。

`internal` 非 package-private，仍可被同进程 Java 反射摸到；只暴露 public 稳定面。

看字节码：Android Studio Show Kotlin Bytecode → Decompile。面试指认 Companion、Continuation、默认参数三处即可。

不该：对 Java 暴露 `suspend` 当唯一 API；不该 release 不 keep 序列化字段名。

## 例子

```kotlin
class User(val id: Int) {
    companion object {
        const val TAG = "U"
        @JvmStatic fun create() = User(1)
    }
}
@JvmOverloads fun load(id: Int, force: Boolean = false) {}
```

错例：去掉 `@JvmStatic`，Java 写 `User.create()` 编译失败，应 `User.Companion.create()`。错例：Java 调 `load(1)` 无 `@JvmOverloads` 找不到单参方法。对例：`suspend` 在 Java 签名里是 `Object fn(Continuation<? super T> c)`。

## 画面

```text
User.kt
  class User / User$Companion / UserKt
  suspend load -> Continuation + 状态机
       -> d8/r8 -> dex -> ART 加载/初始化同 Java
```

## 常见坑与追问

1. **Kotlin 类加载不同于 Java。** 追问：阶段相同，差别在**多了哪些 class**。
2. **Java 默认参数开箱即用。** 追问：要有 `@JvmOverloads` 或 Kotlin 侧调用。
3. **对 Java 直接 export suspend。** 追问：签名多 `Continuation`；用门面。
4. **release Gson 全 null。** 追问：R8 改字段名；`@SerializedName` 或 keep。
5. **`object` 启动即初始化。** 追问：第一次主动使用才 `<clinit>`，与 Java 静态块一致。