---
id: kp-data-sealed
type: knowledge
module: language
title: data class、sealed、object 与 enum
priority: P0
version: 3
order: 60
requires: [kp-oop-basics, kp-equals-hashcode]
---

## 一句话

`data class` 表达「会比、会拷的一份数据」；`sealed` 表达「就这几种形状的结果」；`object` 是单例入口；`enum` 是结构相同的有限命名常量——UI 状态机与网络结果选型错一个，代码要么共享可变要么穷尽检查失效。

## 组成与结构

```text
  data class   值相等 + copy + componentN
  sealed       封闭子类集，when 可穷尽
  object       INSTANCE，类初始化触发
  enum         固定常量实例，同构字段
  companion    命名空间，非 Java static 除非 @JvmStatic
```

| 类型 | 编译器增量 | 别 misuse | 档位 |
|------|------------|-----------|------|
| `data class` | equals/hash/toString/copy | 可变全局、开放继承 | P0 |
| `sealed class/interface` | 子类封闭 | 无限插件类型 | P0 |
| `object` | 懒于类 init | 当可复制数据 | P0 |
| `enum` | 每常量单例 | 异构分支数据 | P0 |

主构造参数须 `val`/`var` 才进 `equals`。`sealed` 直接子类须同模块（可散文件）。`data object` 让无载荷分支也有稳定 equals/toString。

## 原理

1. **data 相等与哈希容器。** 按主构造属性生成 equals/hash。`var` 改字段后 `HashSet` 找不到——状态/key 用 `val`。
2. **copy 浅拷贝。** 嵌套集合同一引用，改内层两边见。发 `StateFlow` 要换新 list，不只 `copy` 外层。
3. **sealed 穷尽。** 无 `else` 的 `when`，加子类则全库编译失败——相对魔法 int 错误码的优势。封闭性来自编译器禁止模块外继承，无运行时「密封指令」。
4. **vs enum。** 枚举常量类加载各一份、字段形状同构；`Success(data)` 要无数 payload 实例，用 sealed。方向/日志级别用 enum。
5. **object 初始化时机。** 第一次主动使用该类（任一 static 入口），JVM 保证一次。不是「进主函数就全初始化」。
6. **sealed interface。** 多能力 + 穷尽；别把几十种子类塞一层成上帝类型。事件用 sealed interface，承载数据用 sealed class 常见。

**失败模式：** 在 `object` 或 `enum` 常量上挂 `mutableListOf` 会让所有引用共享同一堆对象，旋转/多窗口表现为「改一处全变」。`data object Loading` 无载荷但给出稳定 `equals`/`toString`，适合空态分支。Java 调用方没有 Kotlin 穷尽 `when`，SDK 对外状态机要么用 enum 固定分支，要么文档列全子类型并避免静默 `else` 吃掉新错误码。

## 使用与实践

```kotlin
sealed interface UiState {
    data object Loading : UiState
    data class Ok(val items: List<Item>) : UiState
    data class Err(val msg: String) : UiState
}
```

一次性 Snackbar/导航事件不要塞进会被 `distinctUntilChanged` 吞掉的状态流；用 Channel 或 `pending` 消费后清空。

协议稳定码用 enum + `@SerializedName`。不要 enum 装「成功带列表、失败带码」异构体。

## 例子

**正确**

```kotlin
sealed class Result {
    data class Ok(val body: String) : Result()
    data class Err(val code: Int, val msg: String) : Result()
}
fun render(r: Result) = when (r) {
    is Result.Ok -> r.body
    is Result.Err -> "${r.code}:${r.msg}"
}
```

**错误对照：enum 挂可变共享列表**

```kotlin
enum class UiState {
    OK;
    val items = mutableListOf<Item>() // 所有 OK 共享同一 list
}
```

**错误对照：`when` 加 `else` 吃掉新分支**

```kotlin
fun handle(s: UiState) = when (s) {
    UiState.Loading -> Unit
    else -> Unit // 加 Err 子类也不报错
}
```

**错误对照：data + `var` 当 Map key**

```kotlin
data class Key(var id: Int)
val set = hashSetOf(Key(1))
set.first().id = 2
set.contains(Key(1)) // false
```

## 画面

```text
enum：少数单例，字段同形
sealed：少数子类，字段可各异
data：值语义 + copy
object：INSTANCE，首次 touch 初始化
```

## 常见坑与追问

1. **data `var` + HashSet。** 追问：改了啥找不到？hashCode 变，桶错。
2. **sealed 却写 `else`。** 追问：穷尽靠什么？去掉 else 让编译器查全分支。
3. **enum 表示复杂 UI 状态。** 追问：为何别扭？单例+共享可变。改 sealed。
4. **以为 object 进程启动就 init。** 追问：何时跑？首次主动引用该类。
5. **`copy` 以为深拷贝。** 追问：嵌套 list 呢？同一引用，发状态要换内层集合。