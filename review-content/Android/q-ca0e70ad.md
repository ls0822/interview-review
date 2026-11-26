---
id: q-ca0e70ad
type: qa
module: android
knowledge_ref: kp-handler-system
title: Handler 一条消息怎么走完，为什么会漏 Activity
priority: P0
version: 1
---

## 问题
Handler 一条消息怎么走完，为什么会漏 Activity

## 答案
主线程启动时已经做过 `Looper.prepareMainLooper()` 和 `loop()`。`loop` 是个死循环：从 `MessageQueue.next()` 取下一条，调用 `msg.target.dispatchMessage(msg)`。`next()` 在没有消息时会睡着，所以这个死循环不空转占 CPU。

Handler 在构造时记住当前线程的 Looper。你在主线程 `new Handler()`，它就绑主线程的队列。工作线程要发到主线程，就用这个主线程 Handler：`handler.post { }` 或 `sendMessage`。`post(Runnable)` 只是造一条 `callback` 字段不为空的 Message，进的是同一条队列。

子线程自己处理消息：先 `Looper.prepare()`，再 `new Handler()`，最后 `Looper.loop()`。`loop()` 不会返回，所以它后面不要写代码。`HandlerThread` 把这三步包好了。

泄漏的链条：

```text
主线程 MessageQueue
  → Message
    → Handler（target）
      → 非静态内部类，隐式持有外部 Activity
        → Activity 的整棵视图
```

Activity 已经 `onDestroy`，队列里还有一条 10 秒后的消息，这条链就还在，Activity 回收不了。处理：Handler 做成静态内部类，需要 Activity 时用 `WeakReference`；并且在 `onDestroy` 里 `removeCallbacksAndMessages(null)`，把这个 Handler 尚未执行的消息清掉。弱引用只解决「Handler 不硬拿着 Activity」，清消息解决「队列还指着 Handler」。

同步屏障：队列里插入一条没有 target 的特殊消息。普通消息排在它后面先不执行，标成异步的消息可以越过它。Choreographer 用这个保证垂直同步、绘制相关的消息不被一条业务消息堵住。业务代码不要自己插屏障。知道「它是为了让绘制消息插队」就够。

空闲消息 `IdleHandler`：这一轮队列里没有要立刻执行的消息时回调。用来做首帧之后的延迟初始化。里面再做重活，就变成下一次卡顿。
