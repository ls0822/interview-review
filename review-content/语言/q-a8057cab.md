---
id: q-a8057cab
type: qa
module: language
knowledge_ref: kp-data-sealed
title: `data class`、`sealed class`、`enum` 为什么不能
priority: P0
version: 1
---

## 问题
`data class`、`sealed class`、`enum` 为什么不能互换

## 答案
`data class` 按构造参数生成 `equals`、`hashCode`、`copy`、`toString`。`StateFlow` 用 `equals` 判断要不要通知，状态用 data class，改一个字段就 `copy(page = page + 1)`，引用变了，内容比较也正确。

`enum` 的每一项是同一个类型的固定实例。可以有属性，但每项的结构必须一样。适合优先级、连接状态这种封闭的名字：`CONNECTING`、`ONLINE`、`OFFLINE`。

`sealed class` 的子类也是封闭的，但每个子类可以是完全不同的结构：

```kotlin
sealed interface State {
    data object Loading : State
    data class Content(val page: Int) : State
    data class Failed(val reason: String) : State
}
```

`when` 不写 `else` 也能编过，因为编译器知道就这三个。多一个子类，所有 `when` 都会报错，逼你处理。页面状态、用户意图用它。`enum` 做不到「有的项带页码、有的项带错误原因」。
