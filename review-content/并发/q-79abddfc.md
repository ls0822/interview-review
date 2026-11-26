---
id: q-79abddfc
type: qa
module: concurrent
knowledge_ref: kp-coroutine-basics
title: `sleep` 和 `wait`，和协程挂起再比一次
priority: P0
version: 1
---

## 问题
`sleep` 和 `wait`，和协程挂起再比一次

## 答案
`Thread.sleep`：这条线程暂停指定时间，它拿着的 `synchronized` 锁不放。时间到了自己醒。

`object.wait`：必须先进入这个对象的 `synchronized`。调用后放开这把锁，线程进等待集，直到别人对同一对象 `notify` / `notifyAll`，或超时。醒了以后要重新抢到锁才能继续。`wait` 可能假醒，要用 `while (条件不满足) wait()`，不能用 `if`。

协程的 `delay` 对应的是「工单暂停、工人去干别的」，既不是 `sleep` 占着线程，也不是 `wait` 那套监视器。讲的时候主动把三个词分开，面试官就知道你没混。
