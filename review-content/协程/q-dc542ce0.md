---
id: q-dc542ce0
type: qa
module: coroutine
knowledge_ref: kp-coroutine-builders
title: `launch` 是什么？怎么用？
priority: P0
version: 1
---

## 问题
`launch` 是什么？怎么用？

## 答案
1. 在某个 **Scope** 里启动协程，返回 `Job`。  
2. **不追求返回值**；要结果用 `async`。  
3. 示例：

```kotlin
lifecycleScope.launch {          // 在 Scope 里启动
    val data = withContext(Dispatchers.IO) {
        api.load()               // 切到 IO
    }
    textView.text = data         // 回到原 Dispatcher（常是 Main）
}
```

4. `launch(Dispatchers.IO) { }`：从一开始就在 IO 上跑。  
5. **不要** `GlobalScope.launch`（没有业务生命周期，难取消）。

---
