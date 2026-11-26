---
id: q-aba4981a
type: qa
module: coroutine
knowledge_ref: kp-coroutine-basics
title: 恢复还在原来那条线程吗？
priority: P0
version: 1
---

## 问题
恢复还在原来那条线程吗？

## 答案
不保证是同一条 Thread，只保证按 Dispatcher 的规则找线程。

`withContext(Dispatchers.IO)` 花括号里的代码在 IO 池的某条线程上跑。花括号结束，下一行回到调用 `withContext` 之前的那个 Dispatcher。如果是从主线程进来的，下一行回主线程，但是 IO 池里具体哪一条线程，不保证还是刚才那条。

```kotlin
lifecycleScope.launch {          // 主线程
    val text = withContext(Dispatchers.IO) {
        readFile()               // IO 池里某一条
    }
    textView.text = text         // 回到主线程
}
```

`Dispatchers.Main` 只有一条主线程，所以「回到 Main」等于回到那一条。`Main.immediate` 多一个细节：当前已经在主线程时，直接执行，不再往消息队列排一次。
