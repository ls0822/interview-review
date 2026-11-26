---
id: q-f9b6d3f6
type: qa
module: language
knowledge_ref: kp-annotations-exceptions
title: 注解是什么？常见内置注解？
priority: P0
version: 1
---

## 问题
注解是什么？常见内置注解？

## 答案
1. 元数据，给编译器/运行时/工具看。  
2. 常见：`@Override` `@Deprecated` `@SuppressWarnings`；Kotlin `@JvmStatic` `@Throws` `@Nullable` 等。  
3. Android：`@Activity` 无；Jetpack/`@Nullable`、Room、Hilt 等大量注解。

---
