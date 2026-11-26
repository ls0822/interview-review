---
id: q-b3fa1c36
type: qa
module: android
knowledge_ref: kp-touch-dispatch
title: 常见滑动冲突怎么解决？
priority: P0
version: 1
---

## 问题
常见滑动冲突怎么解决？

## 答案
1. 外部拦截：父根据横竖滑决定是否拦截。  
2. 内部拦截：子 `requestDisallowInterceptTouchEvent`。  
3. 嵌套滑动：NestedScrolling 机制。  
4. 讲清「谁处理横向/纵向」比背代码重要。

---
