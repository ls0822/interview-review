---
id: q-80ddf60e
type: qa
module: language
knowledge_ref: kp-null-safety
title: 空安全和平台类型
priority: P0
version: 1
---

## 问题
空安全和平台类型

## 答案
Kotlin 把「可以没有值」写进类型。`String` 不能赋 null，`String?` 才可以。要用里面的值，得 `?.`、`?:` 或先判断。这是编译期拦住空指针。

Java 没有这套标记。Kotlin 调用 Java 方法时，如果 Java 没有 `@Nullable` 或 `@NotNull`，返回值会变成平台类型，编辑器里看起来像普通 `String`，运行时仍可能是 null。一调用方法就空指针。SDK 如果 Java、Kotlin 都要给人用，公共 API 要标空注解；自己接 Java 回调时按可空处理。

`!!` 是断言「这里绝不是 null」，是就抛异常。业务代码里少写，否则只是把编译错误换成崩溃。
