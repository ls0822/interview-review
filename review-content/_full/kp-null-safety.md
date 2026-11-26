---
id: kp-null-safety
type: knowledge
module: language
title: Kotlin 空安全与平台类型
priority: P0
version: 2
order: 50
requires: [kp-val-var-lazy, kp-equals-hashcode]
---

## 一句话

Kotlin 把可空与非空分成两种类型，编译期拦大多数 NPE；从 Java 无空注解进来的 `T!` 平台类型两边都能接，检查变弱——混编边界才是资深题的核心。

## 组成与结构

```text
  String vs String?   编译期可空性
  String!             Java 边界，可空性未知
  ?.  ?:  !!          安全调用 / Elvis / 断言
  智能转换            证明非空后的窄化
  @Nullable/@NonNull  静态契约（包名要对）
```

| 写法 | 含义 | 档位 |
|------|------|------|
| `T` | 不能为 null | P0 |
| `T?` | 可为 null | P0 |
| `T!` | 平台类型 | P0 |
| `lateinit` | 非空但未赋值检查推迟 | P0 |

字节码仍是普通引用；`?.` 在调用点插分支。不是 JVM 有「可空指针类型」。

## 原理

1. **赋值与传参检查。** `String = null` 不过；`String?` 传给 `String` 要在当前分支证明非空：`if (x != null)` 后智能转换，或 `?: return`/`?: throw`。
2. **智能转换失效条件。** `var`、开放属性、自定义 getter——判空与下一行之间可能被写。用局部 `val snapshot = x` 或 `x?.let`。
3. **平台类型缺口。** Java 无注解方法 → Kotlin `String!`。可赋给 `String` 也可 `String?`，赋非空等于隐式断言，null 在使用点 NPE。AndroidX/JetBrains 注解须出现在**调用方可见**的声明（接口、抽象方法），泛型参数也要标。
4. **`!!` 的失败模式。** NPE 栈钉在这一行，适合「再 null 即编程错误」的不变量；不适合 JSON 字段、Intent extra、Binder 返回值。
5. **泛型与 Java 集合元素 null。** `List<String>` 在 Kotlin 语义无 null 元素；Java 仍可 `add(null)`。边界 `List<String?>` 或立即 `filterNotNull()`。
6. **`lateinit` vs 可空。** 非空推迟初始化，未赋值是 `UninitializedPropertyAccessException`；不是平台类型。值类型不能 `lateinit`，用 `by lazy` 或可空。

## 使用与实践

Java 公共 API：参数/返回/泛型参数系统补注解。Kotlin 业务禁大面积 `!!`，Review 搜 `!!` 与 Java 无注解调用。

SDK 边界 Kotlin 封装，把平台类型收成 `String`/`String?` 再进域层。网络字段默认可空，一处收成非空领域模型，别让 `String?` 扩散进 UI。

`findViewById` 时代的可空视图；ViewBinding/`!!` 是技术债信号。

## 例子

**正确**

```kotlin
fun show(name: String) = println(name)
fun fromJava(raw: String?) {
    show(raw ?: "未知")
    raw?.let { show(it) }
}
```

**错误对照：平台类型隐式断言**

```kotlin
fun dangerous(raw: String!) { // 来自 Java 无注解
    val sure: String = raw   // raw 为 null → 这里或下一行 NPE
    show(sure)
}
```

**错误对照：`var` 判空后不能用**

```kotlin
var title: String? = load()
if (title != null) {
    // title 仍是 String?，另一线程可能改成 null
    show(title) // 可能编译失败；即使强行 !! 也有竞态
}
```

**错误对照：`!!` 铺业务路径**

```kotlin
fun bind(intent: Intent) {
    show(intent.getStringExtra("name")!!) // extra 缺失必崩
}
```

## 画面

```text
Kotlin 内部：String / String? 分开
Java 无注解 ──> String!  检查弱
Java @NonNull / @Nullable ──> 明确类型
使用：?.  ?:  智能转换；!! 把 NPE 留本行
```

## 常见坑与追问

1. **「Kotlin 没有 NPE」。** 追问：哪三类还有？`!!`、平台类型、`lateinit` 未初始化；另加 Java/native 边界。
2. **注解加了仍 `!`。** 追问：查什么？JetBrains/AndroidX 包、接口与 override、泛型类型参数。
3. **`var` 不能智能转换。** 追问：局部 `val` 为何可以？编译器证明无写点。
4. **Java `List<String>` 含 null 元素。** 追问：怎么收口？边界 `filterNotNull` 或 `List<String?>`。
5. **`Map` get 的智能转换。** 追问：为何谨慎？ConcurrentHashMap 等每 get 可能变；先赋给局部 val。