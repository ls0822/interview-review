---
id: kp-extensions-hof
type: knowledge
module: language
title: 扩展函数与高阶函数
priority: P0
version: 2
order: 90
requires: [kp-oop-basics, kp-generics]
---

## 一句话

扩展函数是编译成「接收者作首参的静态方法」的语法糖，解析看静态类型、没有运行时多态；高阶函数把函数当值，`inline` 用来消灭 Lambda 对象并让 `reified` 在调用点看见具体类型。

## 组成与结构

```text
  扩展 fun T.foo()  →  FooKt.foo(T receiver)
  高阶 (T) -> R       Lambda / 函数引用
  inline/noinline/crossinline
  SAM / fun interface
  成员优先于扩展
```

| 机制 | 解决什么 | 档位 |
|------|----------|------|
| 扩展 | 不改第三方类加调用写法 | P0 |
| 成员优先 | 扩展不能假扮重写 | P0 |
| `inline` | 热路径零 Function 对象 | P0 |
| `reified` | 擦除后仍能 `T::class` | 专家加分 |
| `fun interface` | Kotlin SAM | P0 |

`@file:JvmName` 改 Java 看到的类名；顶层/扩展都进 `XxxKt`。

## 原理

1. **扩展静态解析。** 接收者**声明类型**决定扩展。`A` 引用指向 `B` 实例，调 `A` 上扩展，不进 `B` 扩展——与虚方法相反，不能当多态扩展点。
2. **成员优先。** 已有同签名成员，扩展不会被选；不能「扩展重写」`toString`。
3. **非 inline Lambda 成本。** 每次调用可能 `FunctionN` 分配；滚动列表热路径会 GC 压力。捕获 `var` 用引用对象包装。
4. **inline 贴入。** 小循环式标准库 `map`/`filter` 展开到调用点。过大公开 inline 膨胀 DEX、混淆栈难读。
5. **非局部 return。** 仅 inline Lambda 可 `return` 外层函数。`crossinline` 禁止，因 Lambda 可能延后执行。`noinline` 某参数仍要对象化。
6. **reified 绑定 inline。** 类型参数只存活到编译；内联后调用点 `T::class.java` 是具体类。不能用于接口虚方法、非 inline 高阶。

## 使用与实践

模块内工具扩展放同包；SDK 核心能力用真实成员/static + `@JvmStatic`，Java 方能直接调。

Java 回调：`fun interface` 或 Java 接口，别只靠 Kotlin 函数类型（Java 侧 `Function1` 难用）。

`apply`/`also`/`let`/`run`/`with`：构建用 `apply`，空安全链 `let`，副作用日志 `also`。套五层以上拆变量。

## 例子

**正确**

```kotlin
fun String.lastCodePoint(): Int = codePointAt(length - 1)

inline fun <reified T> List<*>.firstInstance(): T? {
    for (e in this) if (e is T) return e
    return null
}

fun interface Tap { fun on(id: Int) }
fun bind(t: Tap) {}
bind { id -> println(id) }
```

**错误对照：用扩展「覆盖」成员**

```kotlin
fun View.show() { visibility = View.VISIBLE }
// 若 View 已有 show() 语义不同的成员？不会选你的扩展；混淆靠 import/静态解析
```

**错误对照：期望扩展多态**

```kotlin
open class A
class B : A()
fun A.tag() = "A"
fun B.tag() = "B"
fun demo(a: A) = a.tag() // 永远 "A"，即便 a 是 B
```

**错误对照：非 inline 里非局部 return**

```kotlin
fun findEmpty(list: List<String>, pred: (String) -> Boolean) {
    list.forEach {
        if (pred(it)) return // 非法：Lambda 非 inline
    }
}
```

## 画面

```text
"hi".lastCodePoint()
  → StringExt.lastCodePoint("hi")  编译期绑定

虚方法：看对象类型
扩展：看引用类型

inline filter { } → 调用点展开成 for 循环
```

## 常见坑与追问

1. **扩展模拟重写。** 追问：父引用子对象调扩展？父类型上解析的那个。要多态写成员。
2. **Java 调扩展。** 追问：在哪？`FileKt.foo(receiver)`。核心 API 不要只放扩展。
3. **大户 inline。** 追问：坏处？DEX 膨胀、断点诡异。小而频或 reified。
4. **forEach 里 return。** 追问：何时合法？外层函数 inline + Lambda inline；否则 `return@forEach`。
5. **扩展与作用域函数同名 import。** 追问：两个同名扩展？import 冲突/接收者类型分派，不是重载覆盖。