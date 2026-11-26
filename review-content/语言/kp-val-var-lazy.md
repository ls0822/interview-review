---
id: kp-val-var-lazy
type: knowledge
module: language
title: val、var、lateinit、lazy 与 inline
priority: P0
version: 2
order: 20
requires: [kp-oop-basics]
---

## 一句话

`val` 锁的是引用不能二次赋值，不是对象里不能再改；`lateinit` 把「必须非空」的证明推迟到第一次读；`lazy` 把昂贵初始化推迟到第一次读并默认同步；`inline` 是函数调用优化，和前三者不是同一层机制。

## 组成与结构

```text
  val/var ──属性/局部──> 引用可变性
  lateinit ──非空引用类型──> 用时才检查是否写过
  by lazy ──委托──> 第一次 get 算一次、记下来
  const val ──编译期常量──> 注解参数、内联到调用方
  inline ──函数──> 调用点展开，支撑 reified / 非局部 return
```

| 写法 | 赋值时机 | 空与类型 | 并发默认 |
|------|----------|----------|----------|
| `val` | 一次 | 可 `T?` | 普通字段语义 |
| `var` | 随时 | 同上 | 共享需 `@Volatile`/锁 |
| `lateinit var` | 用前某刻 | 仅非空引用类型 | 不帮你同步 |
| `by lazy` | 首次 `get` | 按表达式 | `SYNCHRONIZED` |
| `const val` | 编译期 | 基本类型+String | 无运行时 |

`LazyThreadSafetyMode`：`SYNCHRONIZED`（默认）、`PUBLICATION`（允许多线程算一次取结果）、`NONE`（调用方保证单线程）。

## 原理

1. **val 的语义分层。** 主构造 `val` 生成 private field + getter，无 setter。局部 `val` 是编译器禁止再赋值。容器类型 `val list = mutableListOf()` 仍可 `add`——不变的是「这根引用」，不是「堆里那份内容」。不可变状态 = `val` + 不可变数据结构或每次 `copy` 出新快照（配合 `StateFlow`）。
2. **var 与内存可见性。** 多线程读 `var` 无 `@Volatile` 可能长期见旧引用。`val` 指向不变、且对象本身不可变并安全发布后，读者不会突然换引用——这是 Compose/Reducer 偏好 `val` 的原因之一。
3. **lateinit 的实现直觉。** 访问前插入「是否已赋值」检查；未赋值抛 `UninitializedPropertyAccessException`，不是 NPE。不能用于 `Int` 等值类型：字段初值 0 与「未设置」无法区分，实现靠引用 null 作哨兵。`by lazy` 或 `Int?` 可替代。
4. **lazy 的一次性。** 双重检查加锁：先无锁读缓存，未命中再进锁算一次。不要在 `lazy` 里做可能失败且需重试的网络/IO——失败路径与是否缓存「半初始化」因版本细节而异，设计上应把 lazy 块当纯、可重复、无副作用。
5. **属性委托 vs lateinit。** `by lazy`/`by viewModels` 走 `getValue`；`lateinit` 是语言级标记，无额外委托对象。委托每次 get 多一层调用，inline 后常能消掉。
6. **inline 为何常和本专题同考。** 内联消 Lambda 分配，允许 `reified` 与非局部 `return`；不改变 val 赋值规则。大函数 inline 会膨胀字节码；公开 API 慎用在整个类体。

## 使用与实践

DI、`onCreate` 才有 `Context` 的字段用 `lateinit`，并在生命周期边界前保证已写。能构造时写死的用 `val`。

数据库、重配置解析用 `lazy`；若必须主线程初始化，不要让后台线程第一次触碰——改为主线程显式 warm-up。

`lazy` 不要闭包抓住 `Activity`/`Fragment` view——委托挂在长生命周期对象上会把界面泄漏。

UI 状态：`val state` + `data class.copy`，少用 `var` 就地改字段逃避相等性判断。

热路径小高阶才 `inline`；页面级函数标 inline 无收益。

## 例子

**正确：lateinit + lazy 分工**

```kotlin
class RoomScreen {
    lateinit var title: String
    val lines = mutableListOf<String>() // val 引用，内容可变
    val db by lazy { openDb() }

    fun onCreate() {
        title = "直播"
        lines += "msg"
        db.query() // 首次触发 lazy
    }
}
```

**错误对照：lateinit 未赋值就读**

```kotlin
class Bad {
    lateinit var router: Router
    fun start() {
        router.navigate("/") // UninitializedPropertyAccessException
    }
}
```

**错误对照：lazy 里注册监听却不管生命周期**

```kotlin
class Holder {
    val repo by lazy {
        GlobalBus.register { /* 抓住 Activity */ }
        Repo()
    }
}
// 第一次碰 repo 时机不确定；Bus 可能永远不反注册
```

**错误对照：把 inline 当成变量内联**

```kotlin
// reified 只能出现在 inline 函数；普通属性不能 reified
inline fun <reified T> parse(): T = /* T::class */
```

## 画面

```text
val   引用写一次 ──> 堆对象仍可能变
var   引用可换 ──> 多线程要可见性
lateinit  用时检查「写过没」
lazy      第一次 get：锁 → 计算 → 缓存
inline    贴进调用点（另一层：调用优化）
```

## 常见坑与追问

1. **「val = 不可变对象」。** 追问：`val` 的 `MutableList` 能 add 吗？能。真正不变是类型没有写入口或拷贝后交出。
2. **lateinit 用于 `Int`。** 追问：为何编译失败？无 null 哨兵区分未赋值与 0。
3. **lazy 里 `launch` / 副作用。** 追问：初始化几次？成功路径一次，但时机不确定且可能持有关键引用。改显式 `start()`。
4. **`LazyThreadSafetyMode.NONE` 在多线程。** 追问：会怎样？可能算多次、竞态写缓存。单线程外不要用 NONE。
5. **inline 与 reified。** 追问：为何必须 inline？类型参数擦除后，只有贴进调用点才知道具体 `T`。
