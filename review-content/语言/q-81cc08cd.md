---
id: q-81cc08cd
type: qa
module: language
knowledge_ref: kp-java-kotlin-interop
title: 为什么 Android 推 Kotlin？混编最大坑？
priority: P0
version: 1
---

## 问题
为什么 Android 推 Kotlin？混编最大坑？

## 答案
1. 推：空安全、简洁、协程、与 Jetpack/Compose 一体。  
2. 混编坑：平台类型导致 NPE；suspend 难被 Java 调；扩展/默认参数对 Java 不友好。  
3. 对策：注解、`@JvmStatic`/`@JvmOverloads`/`@Throws`、对外 Java 友好门面。  
4. 详解：[语言专题 QC2](../语言-Kotlin与Java.md)。

---
