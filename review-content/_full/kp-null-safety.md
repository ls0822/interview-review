---
id: kp-null-safety
type: knowledge
module: language
title: Kotlin 空安全与平台类型
priority: P0
version: 1
---

## 一句话

Kotlin 把「不能为 null」和「可以为 null」分成两种类型；从 Java 进来、又没有空注解的类型会变成平台类型 `T!`，编译器不再替你守门。

## 组成与结构

| 写法 | 含义 |
|------|------|
| `String` | 此类型的值不能是 null |
| `String?` | 可以是 null |
| `String!` | 平台类型，可空性未知，只出现在 Java 边界 |
| `?.` | 接收者 null 则整段为 null，不调用 |
| `?:` | 左边 null 时用右边 |
| `!!` | 断言非空，null 就抛 NPE |
| `?.let { }` | 非空才进入块 |

可空类型在字节码里仍是普通引用，安全调用会在调用点变成判空分支。所以空安全是编译器纪律加上插入的检查，不是 JVM 有一种「可空指针硬件」。

Java 的 `@Nullable` / `@NonNull`（androidx 或 JetBrains 那套）是给 Kotlin 编译器看的注解。注解包名不对、只加在实现类没加在接口、加在方法上没加在泛型参数上，Kotlin 仍把它当平台类型。

## 原理

1. **赋值检查。** `var a: String = null` 编译失败。`var b: String? = null` 通过。把 `b` 传给需要 `String` 的参数，必须在当前分支里证明它不是 null：`if (b != null)` 之后的智能转换，或 `b ?: return`。
2. **智能转换会失效。** 局部不可变 `val` 判空之后可以当非空用。`var` 如果可能被别的线程、别的属性 setter 改掉，编译器拒绝智能转换，因为判空和下一行之间值可能变了。开放属性、自定义 getter 也一样。这时用局部 `val` 接一次，或用 `?.`。
3. **平台类型从哪来。** Java 方法 `String getName()` 没有注解时，Kotlin 看到的是 `String!`。你可以把它赋给 `String`，也可以赋给 `String?`，编译器都放行。赋给 `String` 等于你做了隐式断言，运行到 null 就在使用点 NPE。这是混编最大的空安全缺口。
4. **`!!` 的位置。** 它把 NPE 固定在这一行，栈很好看，但等于放弃检查。只适合「再为 null 就是编程错误，应该马上失败」的不变量，不适合网络字段、Bundle、Intent extra。
5. **泛型和空。** `List<String>` 在 Kotlin 里元素不应为 null。Java 的 `List<String>` 仍可能被塞进 null。读出来当 `String` 用会炸。边界上用 `List<String?>` 承接，或立刻 `filterNotNull()`。
6. **lateinit 和空安全的关系。** `lateinit var` 声明的是非空类型，但在赋值前访问会抛 `UninitializedPropertyAccessException`，不是编译期能拦住的。它不是平台类型，是「我保证在用之前赋值」。基本类型不能 lateinit，因为没有 null 哨兵来表示还没赋值；那种延迟用 `by lazy` 或可空 `var`。

## 使用与实践

Java 公共 API：参数和返回值系统补上空注解，泛型参数也要补。Kotlin 调用处不要依赖平台类型，写成明确的 `String` 或 `String?`，让编译器帮你。

SDK 边界做一层 Kotlin 封装，把 Java 的可空性收成明确类型再进业务。业务代码禁止大面积 `!!`。Review 时搜 `!!` 和未标注的 Java 调用。

网络 JSON 字段默认按可空建模，解析后在一处收成非空领域模型，不要让 `String?` 扩散到整个 UI 层。

## 例子

```kotlin
fun show(name: String) { println(name) }

fun fromJava(raw: String?) {
    show(raw ?: "未知")
    raw?.let { show(it) }
}

fun dangerous(raw: String!) { // 平台类型只在 Java 互操作里出现，手写仅作示意
    val sure: String = raw     // raw 为 null 时，这里或下一行 NPE
    show(sure)
}
```

Java：

```java
public final class Names {
    public static @Nullable String nick(@NonNull User user) {
        return user.nick;
    }
}
```

Kotlin 侧 `Names.nick(user)` 的类型应是 `String?`。如果注解没生效，IDE 里会显示 `String!`，这就是要修的信号。

## 画面

```text
Kotlin 内部：String 与 String? 编译期分开
        |
Java 无注解 -----> String!  检查变弱
Java @NonNull --> String
Java @Nullable -> String?
        |
使用点：?.  /  ?:  /  智能转换     !! 则把 NPE 留在这一行
```

## 常见坑与追问

1. **说 Kotlin 不会 NPE。** 追问：哪三种还会炸？`!!`、平台类型、`lateinit` 未初始化。另外 Java 空数组、解引用原生代码不在类型系统里。
2. **注解加了仍是平台类型。** 追问：查什么？注解是否是 Kotlin 认识的包、是否在接口和 override 上、泛型是否标到类型参数。
3. **`var` 判空后不能当非空用。** 追问：为什么局部 val 可以？编译器证明中间没有写点。
4. **`List<String>` 从 Java 来仍有 null 元素。** 追问：怎么收口？边界 `mapNotNull` 或声明 `List<String?>`。
