---
id: q-coroutine-state-machine
type: qa
module: coroutine
knowledge_ref: kp-coroutine-internals
title: suspend 如何编译成状态机？yield 和 delay(0) 差在哪？
priority: P1
version: 1
---

## 问题
挂起函数在编译之后是什么？`label`、`result`、`COROUTINE_SUSPENDED` 各干什么？为什么恢复不保证同一条线程？为什么普通函数不能调用 `suspend`？`yield()` 和 `delay(0)` 为什么不能互换？

## 答案
编译器做的是 CPS：每个 `suspend` 函数多一个 `Continuation` 参数，变换后的返回类型是 `Any?`。一次调用对应一个状态机对象，跨过挂起点还要用的局部变量放在它的字段里，不跨过的不必进堆。

`label` 是下次从哪个挂起点之后继续。调用下一个挂起函数之前先把 `label` 写成「恢复后要进的那一档」，这样慢路径回来时不会把请求再发一次。`result` 是 `resumeWith` 带来的值或异常；恢复后先把失败重新抛出，所以挂起点外面的 `try/catch` 仍然接得住。`COROUTINE_SUSPENDED` 是哨兵：内层真的挂起了，调用方必须立刻把哨兵往上传并退栈，不能把哨兵当返回值。内层如果直接给出真实结果，就是快路径，当前栈上继续，线程不会让出。`delay` 在时间小于等于 0 时就走这条快路径，直接 return。

挂起期间 JVM 栈是空的，返回地址在状态机的 `completion` 链上。这就是大量等待中的协程不需要大量线程栈。真结束时用非哨兵的结果去恢复外层续体。

谁调用 `resume`，先经过 `ContinuationInterceptor`。Dispatcher 就是这个拦截器，它把续体包成 `DispatchedContinuation`，按 `isDispatchNeeded` 决定是丢进线程池 / 主线程队列，还是就地执行。结果往往在定时器或网络回调线程上准备好，拦截器拒绝在那条线程上接着跑用户代码，所以恢复不保证还是挂起前那个 worker。`Main` 总在同一条线程，是因为主线程只有一条。`Main.immediate` 在已经处于主线程时不再排队，`viewModelScope.launch` 的开头可能在 `launch` 返回前就跑完。`Unconfined` 不把线程纠正回来，谁 `resume` 就留在谁的线程上。

普通函数没有 `Continuation` 参数，编译器无处上传哨兵，所以不能调用 `suspend`。`launch` 的 lambda 自己就是挂起类型。`runBlocking` 靠堵住当前线程来桥接，Android 主线程上再切回 `Main` 会死锁。

`yield()` 入口先 `ensureActive()`，再把续体重新派发，给同一调度器上已经排队的协程机会。只有自己一个协程时它可能并不真挂起，但取消检查仍在。它不保证另一个协程会先跑完，不能拿来当 `join`。`delay(0)` 不挂起，也不是取消点，不能当 `yield`。

`inline suspend` 只是把状态机嵌进调用方。lambda 要逃逸保存，必须 `noinline`。`crossinline` 只禁止非局部 return。`runCatching` 这种内联 catch 会把 `CancellationException` 收进 `Result`，可取消代码里不要靠它包整段挂起。
