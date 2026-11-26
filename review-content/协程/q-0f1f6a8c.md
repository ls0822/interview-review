---
id: q-0f1f6a8c
type: qa
module: coroutine
knowledge_ref: kp-collections
title: `flatMapLatest` / `Concat` / `Merge`？
priority: P1
version: 1
---

## 问题
`flatMapLatest` / `Concat` / `Merge`？

## 答案
1. **Concat**：一个接一个，保序。  
2. **Merge**：多个内部流并发收。  
3. **Latest**：新值来了 → **取消**上一个内部流（搜索联想神器）。

---
