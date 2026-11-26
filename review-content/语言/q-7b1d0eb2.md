---
id: q-7b1d0eb2
type: qa
module: language
knowledge_ref: kp-extensions-hof
title: 扩展函数本质？
priority: P0
version: 1
---

## 问题
扩展函数本质？

## 答案
编译成静态方法，第一个参数是接收者；不能真正多态覆盖成员；对 Java 是 `XxxKt.method(receiver)`。

---

## 1.2 Java 与 Kotlin 对比
