---
id: q-suspend-vs-launch-block
type: qa
module: coroutine
knowledge_ref: kp-coroutine-builders
title: launch/async 里的方法都是挂起函数吗？
priority: P0
version: 1
---

## 问题
`launch` 或 `async` 里的方法是不是都是挂起函数？

## 答案
不是。

`launch` / `async` 的 lambda 本身是 **suspend 上下文**（类型大致是 `suspend CoroutineScope.() -> …`），所以块里**可以调用** `delay`、`withContext`、其它 `suspend fun`。

但这不会把你写的普通方法变成挂起函数：

- `fun doWork()` 仍是普通函数，不能在里面调 `delay`。
- 只有写成 `suspend fun doWork()` 才是挂起函数。
- 块里直接写的普通代码、Java 回调 API，默认都不是挂起；没有挂起点就不会让出线程。

一句话：`launch`/`async` 提供可挂起的**执行环境**，不是批量给里面所有方法加 `suspend`。
