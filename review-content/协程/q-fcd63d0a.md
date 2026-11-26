---
id: q-fcd63d0a
type: qa
module: coroutine
knowledge_ref: kp-coroutine-channel-mutex
title: Channel 是什么？怎么用？
priority: P0
version: 1
---

## 问题
Channel 是什么？怎么用？

## 答案
1. **Channel = 协程之间的队列通道**。  
2. `send` 发（缓冲满可挂起），`receive` 收（空可挂起）。  
3. 典型：一个生产者、多个/一个消费者。

```kotlin
val channel = Channel<String>(capacity = 10)

// 生产者
scope.launch {
    for (i in 1..100) channel.send("task-$i")
    channel.close() // 结束信号
}

// 消费者
scope.launch {
    for (task in channel) { // close 后循环结束
        handle(task)
    }
}
```

---
