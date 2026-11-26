---
id: kp-val-var-lazy
type: knowledge
module: language
title: val、var、lateinit、lazy 与 inline
priority: P0
version: 1
---

## 一句话

`val` 是引用只能赋一次，不是对象内部不可变；`lateinit` 把非空检查推迟到第一次使用；`lazy` 在第一次读取时初始化并可同步；`inline` 则是另一件事，用来把函数体贴进调用点。

## 组成与结构

| 写法 | 赋值时机 | 空与类型 | 线程 |
|------|----------|----------|------|
| `val` | 声明时或 init 里一次 | 可以是可空类型 | 看普通字段 |
| `var` | 随时改 | 同上 | 改引用不是原子发布，共享时要同步 |
| `lateinit var` | 用之前的某个时刻 | 只能非空引用类型，不能 Int | 赋值本身不管并发 |
| `by lazy` | 第一次 `get` | 类型按表达式 | 默认 `LazyThreadSafetyMode.SYNCHRONIZED` |
| `const val` | 编译期常量 | 只能基本类型和 String | 内联到调用方 |

`lazy` 的模式还有 `PUBLICATION`（允许多个线程同时算，取其中一个）和 `NONE`（调用方保证单线程，最快）。默认模式用双重检查加锁，初始化只成功一次。

`inline` 和这组属性关键字经常被放在同一题里问，因为它也是「少一次间接」：不生成 Lambda 对象，并允许 `reified` 和非局部 return。它不改变 val 的赋值规则。

## 原理

1. **val 的字节码。** 主构造 `class User(val id: Int)` 生成私有字段、getter，没有 setter。局部 `val` 是编译器禁止再赋值。若类型是 `MutableList`，`val list` 仍可以 `add`，变的是对象内容，不是引用。真正的不可变要靠不可变数据结构或只暴露只读接口加拷贝。
2. **var 与可见性。** 多线程读 `var` 引用，没有 `@Volatile` 或锁时，别的线程可能一直看见旧引用。`val` 指向不可变对象、并且安全发布之后，读者看到的引用不会换成另一份。这是更喜欢 `val` 状态的并发理由。
3. **lateinit 的检查。** 编译器在每次访问前插入「是否已初始化」的字段标志检查。没赋值就抛 `UninitializedPropertyAccessException`。它不能用于 `Int`、`Boolean`，因为这些类型没有一个额外的「未设置」比特，实现上靠引用 null 当哨兵，而基本类型字段会先是 0/false，和业务值分不开。可空 `var name: String? = null` 能表达「还没有」，但类型会变成可空，后续都要处理 null。
4. **lazy 的一次初始化。** 默认实现：先无锁读已完成的值，没有则进入同步块，再检查一次，然后执行 Lambda，把结果存下来。Lambda 里的异常不会把「失败」缓存成永久结果的说法不要说死在所有版本上；面试按「初始化应该是纯的、失败就让调用方看见并允许重试」来设计，不要在 lazy 里做可能失败的网络。
5. **和 by viewModels 一类委托的差别。** `by` 是属性委托，`getValue`/`setValue` 接管读写。`lazy` 是标准库委托。`lateinit` 不是委托，是语言对属性的特殊标记。委托可以懒、可以打日志、可以映射到 Map，但每次访问多一次调用，内联后常常能消掉。
6. **inline 的边界。** 内联函数体不要太大。公开 inline 函数不能访问 private 成员的限制在新版本有所放宽（访问会变成 public 的合成方式），但仍不要靠 inline 去打破封装。`reified` 只存在于 inline 函数。属性的 getter 也可以 inline，那是访问器优化，和 lazy 不冲突。

## 使用与实践

依赖注入、`onCreate` 里才有 Context 的字段，用 `lateinit`，并在用之前保证生命周期已经走到。能在声明时构造的用 `val`。

真正贵的对象（数据库、大配置解析）用 `lazy`，确认默认线程安全够不够。若初始化必须发生在主线程，不要从多个线程第一次碰它，改成主线程显式初始化。

`lazy` 不要捕获 Activity。委托存在长生命周期对象上时，Lambda 抓住的界面也会留下来。

状态字段优先 `val` 加新对象，而不是 `var` 改旧对象。和 `StateFlow`、`data class copy` 是一套。

热路径上的小高阶函数才 `inline`。业务页面函数标 inline 没有意义。

## 例子

```kotlin
class RoomScreen {
    lateinit var title: String
    val adapter = mutableListOf<String>() // 引用不变，内容可变
    val db by lazy { openDatabase() }      // 第一次读才打开，默认加锁

    fun start() {
        title = "直播"
        adapter += "msg"
        db.query()
    }
}

inline fun <reified T> typeName(): String = T::class.java.simpleName
```

```kotlin
val n: Int by lazy(LazyThreadSafetyMode.NONE) { compute() } // 仅单线程访问时
```

`const val MAX = 3` 可以放在注解参数里；普通 `val MAX = 3` 不行，因为它不是编译期常量。

## 画面

```text
val   引用一次写死 ---- 对象内容仍可能变
var   引用可换
lateinit  非空，用时才检查有没有写过
lazy      第一次 get：加锁 -> 计算 -> 记住
inline    调用点展开，和属性懒加载不是同一层
```

## 常见坑与追问

1. **说 val 就是不可变。** 追问：`val list = mutableListOf()` 能不能 add？能。不可变是没有写入口或拷贝。
2. **lateinit 用在 Int 上。** 追问：为什么不行？实现靠 null 哨兵，基本类型没有。改用可空或委托。
3. **lazy 里启动协程或注册监听。** 追问：会初始化几次？成功路径一次，但时机不确定，还可能抓住外部生命周期。改为显式 start。
4. **把 inline 理解成「这个变量内联」。** 追问：reified 为什么非要 inline？类型信息只在被贴进调用点时还在，和 val 的单次赋值无关。
