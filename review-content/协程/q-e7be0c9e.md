---
id: q-e7be0c9e
type: qa
module: coroutine
knowledge_ref: kp-coroutine-flow
title: `flowOn` 干什么？
priority: P0
version: 1
---

## 问题
`flowOn` 干什么？

## 答案
1. **只切换上游**在哪个 Dispatcher 执行。  
2. `collect` 仍在调用 collect 的协程上下文里（常在 Main）。  

```kotlin
flow { emit(load()) }      // 想在 IO 产数据
  .flowOn(Dispatchers.IO)
  .collect { updateUi(it) } // 在 Main collect
```

---
