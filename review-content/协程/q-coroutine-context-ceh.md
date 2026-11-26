---
id: q-coroutine-context-ceh
type: qa
module: coroutine
knowledge_ref: kp-coroutine-context
title: CoroutineExceptionHandler 什么时候才会生效？
priority: P0
version: 1
---

## 问题
`CoroutineContext` 怎么合并，子协程继承哪些元素？`CoroutineExceptionHandler` 和 `try/catch`、`async`、`supervisorScope` 各在什么时候接手异常？

## 答案
上下文是按 Key 放的一组元素，`+` 合并，同 Key 右边覆盖左边。面试常写的四样是 `Job`、Dispatcher（Key 实际是 `ContinuationInterceptor`，所以不能和另一个拦截器并存）、`CoroutineName`（只供调试）、`CoroutineExceptionHandler`。

子协程先拿「父上下文 + 本次传入的上下文」，没有调度器就补 `Dispatchers.Default`，然后新建自己的 `Job` 换掉上下文里的 Job。体内的 `coroutineContext[Job]` 是自己，父亲在 parent 指针上。`launch(Job())` 会把父亲换成这个新 Job，Scope 取消不到它。只换 `Dispatchers.IO` 不会拆掉父子关系。`SupervisorJob()` 当 `launch` 的参数同样是换父；`supervisorScope` 自己仍是外层的孩子，只是不因孩子失败而取消兄弟。

CEH 不是 `try/catch`。三条同时成立才调用，而且调用时协程已经死了，不能在里面恢复现场：

1. 异常不是 `CancellationException`（`TimeoutCancellationException` 也算取消，漏出 `launch` 通常不会当业务错误上报）。
2. 没人接住：协程体里没 catch，也没通过 `coroutineScope` / `withContext` / `await` 交回调用方。
3. 父不接手。普通父 Job 会接手并取消兄弟，子上的 CEH 永远不跑。父是 `SupervisorJob`，或这已经是根上的 `launch`，才轮到上下文里的 handler；没有 handler 就走平台默认处理，Android 上常崩溃。

`try/catch` 包住 `launch` / `async` 那一行没用，那一行立刻返回。catch 要写在协程体里，或包住会重新抛出的挂起函数。

`async` 把异常放进 `Deferred`，自己的 CEH 不生效；不 `await` 也不会改道进 CEH。但普通父仍会因为这个孩子立刻取消，不必等到 `await`。`coroutineScope` 把子异常抛给调用方，catch 住就不进 CEH。`supervisorScope` 里的 `launch` 失败不取消兄弟，因此变成未捕获，必须在内部 catch 或带上 handler。`viewModelScope` 的父就是 `SupervisorJob`，一个子 `launch` 失败不会拆掉其他子协程，也不会自动变成界面错误态。
