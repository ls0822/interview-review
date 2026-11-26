---
id: kp-extensions-hof
type: knowledge
module: language
title: 扩展函数与高阶函数
priority: P0
version: 1
---

## 一句话

扩展函数是编译成静态方法的语法糖，没有运行时多态；高阶函数把函数当参数，`inline` 用来消掉 Lambda 对象，并让 `reified` 在调用点看见具体类型。

## 组成与结构

扩展写在被扩展类型的外面：`fun String.lastChar(): Char`。编译后大致是 `StringKt.lastChar(String receiver)`，Java 就按这个静态方法调用。顶层函数同样进「文件名 + Kt」的类，可用 `@file:JvmName` 改类名。

高阶函数的参数或返回值是函数类型，例如 `(Int) -> Boolean`。Lambda `{ it > 0 }` 是函数字面量。若 Lambda 是最后一个参数，调用时可以放到括号外，这是尾随 Lambda。

| 机制 | 解决什么 |
|------|----------|
| 扩展 | 给别人的类型加调用写法，不改原类 |
| 成员优先 | 同签名时成员赢，扩展不能偷偷覆盖成员 |
| SAM / `fun interface` | 单抽象方法可以用 Lambda |
| `inline` | 把函数体和 Lambda 贴进调用处 |
| `noinline` / `crossinline` | 个别 Lambda 不要内联，或禁止非局部 return |
| `reified` | 内联后能用 `T::class` |

Java 的函数式接口（只有一个抽象方法，如 `Runnable`、`OnClickListener`）在 Kotlin 里可以直接写 Lambda。Kotlin 自己的接口要标 `fun interface` 才有同样的 SAM 转换。

## 原理

1. **解析在编译期。** 扩展的接收者静态类型决定调用哪个扩展。`open class A; class B : A()`，你对 `A` 写了扩展，对 `B` 又写了同名扩展。变量类型是 `A`、实际对象是 `B` 时，调用的仍是 `A` 的扩展。这和虚方法相反。所以扩展不能当多态的扩展点。
2. **成员优先。** 类里已经有同签名成员时，扩展不会被选中。你不能用扩展去「重写」`toString` 或 SDK 的已有方法。
3. **Lambda 的对象。** 非内联高阶函数在字节码里要把 Lambda 变成对象（匿名类或 invokedynamic）。它能访问外部变量，Kotlin 的 Lambda 可以改外部 `var`，编译器会用包装对象保存。每次调用都分配这个对象，在滚动或绘制热路径上会制造垃圾。
4. **inline 贴进去。** `inline fun <T> List<T>.filter(...)` 会把循环和 Lambda 体复制到调用点，不再分配函数对象。代价是字节码变大，所以只对小而频繁、或需要 `reified` / 非局部 return 的函数 inline。公开 API 的大函数体不要 inline，调用方会膨胀，调试栈也会变怪。
5. **非局部 return。** 内联 Lambda 里的 `return` 返回的是外层函数，而不是 Lambda 自己。这让 `forEach` 里能直接从 `fun` 返回。非内联 Lambda 不能这样，只能 `return@label`。`crossinline` 禁止这种非局部 return，因为 Lambda 可能被存起来稍后调用，那时外层函数已经不在栈上。
6. **reified 依赖 inline。** 类型参数平时被擦除。inline 之后调用点知道具体类型，编译器把 `T::class.java` 换成具体的 class 字面量。所以 `reified` 不能用在接口的抽象方法、不能用在非 inline 函数、也不能用在递归且需要当普通函数引用传递的场合。

## 使用与实践

给本模块的类型加展示、映射、日志，用扩展，放在同一文件，不要散落到全局名字。SDK 对外的核心能力写成真正的成员或静态方法，因为 Java 调用方看不到「像成员一样的扩展」，还要记 `XxxKt`。

集合变换用标准库 `map` / `filter` / `flatMap`。需要提前结束用 `firstOrNull`、`any`，或内联作用域里的 `return`。热路径上自己写的、抓住 Lambda 的函数考虑 `inline`。

回调若要给 Java 用，定义 Java 接口或 `fun interface`，不要只给一个 Kotlin 函数类型。函数类型在 Java 里是 `Function1`，调用别扭。

`apply` / `also` / `let` / `run` / `with` 是带接收者的高阶函数：`apply` 返回接收者，适合构建；`let` 适合空安全后的转换；`also` 适合插入日志而不改变值。不要套五层，读不懂就拆成局部变量。

## 例子

```kotlin
fun String.lastChar(): Char = this[length - 1]

inline fun <reified T> List<*>.firstOf(): T? {
    for (e in this) if (e is T) return e
    return null
}

fun interface Click {
    fun onClick(id: Int)
}

fun bind(click: Click) {}

fun demo(items: List<Any>) {
    "hi".lastChar()
    bind { id -> println(id) }          // SAM
    val n = items.firstOf<String>()
    listOf(1, 2, 3).filter { it > 1 }    // 尾随 Lambda，标准库 inline
}
```

Java 调用扩展：`StringExtKt.lastChar("hi")`，类名以文件为准。

非局部 return：

```kotlin
fun containsEmpty(list: List<String>): Boolean {
    list.forEach {
        if (it.isEmpty()) return true // 从 containsEmpty 返回
    }
    return false
}
```

## 画面

```text
"hi".lastChar()
    编译期选定静态方法 StringKt.lastChar("hi")
    运行期不看 "hi" 的子类

filter { } 若 inline：
    调用点展开成循环，没有额外 Function 对象
```

## 常见坑与追问

1. **用扩展模拟重写。** 追问：父类型引用指向子对象时走哪个？走父类型上解析到的那个扩展。要多态就写成员。
2. **Java 找不到扩展。** 追问：它在哪个类？文件级 Kt 类的静态方法。核心 API 不要只放扩展。
3. **到处 inline。** 追问：坏处是什么？调用点字节码膨胀，调试困难。只给小函数和 reified。
4. **非内联 Lambda 里写 return。** 追问：为什么编译失败？那会返回一个已经不在栈上的函数。用 `return@forEach`，或把函数改成 inline。
