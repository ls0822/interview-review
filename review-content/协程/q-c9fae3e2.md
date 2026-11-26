---
id: q-c9fae3e2
type: qa
module: coroutine
knowledge_ref: kp-coroutine-basics
title: 协程和线程差在哪？挂起是不是阻塞？
priority: P0
version: 1
---

## 问题
协程和线程差在哪？挂起是不是阻塞？

## 答案
线程由操作系统调度。`Thread.sleep` 或阻塞式 `socket.read` 时，这条线程一直占着，别的任务上不来。一百个阻塞请求往往就要近一百条线程，线程有栈，多了费内存，切换也贵。

协程跑在线程上面。`delay`、`withContext`、挂起函数形式的网络请求，执行到这里会挂起：线程不被睡死，去跑别的协程。所以几十条线程能撑住很多个正在等网络的协程。

挂起不等于阻塞。对照：

| | `delay(1000)` | `Thread.sleep(1000)` |
|--|--|--|
| 线程 | 放开，可以干别的协程 | 占着干等 |
| 谁在等 | 这一张工单在等 | 这个工人在等 |

协程没有取消线程。`Dispatchers` 背后仍是线程或线程池。主线程上如果调用了真正阻塞的 API（普通 Socket、大文件直接读），主线程照样卡，协程救不了。
