---
id: q-2bfd8e0f
type: qa
module: language
knowledge_ref: kp-annotations-exceptions
title: 注解怎么被“用起来”？
priority: P0
version: 1
---

## 问题
注解怎么被“用起来”？

## 答案
1. **编译期**：APT/KSP（ButterKnife 老、Room、Hilt、ARouter 等）生成代码。  
2. **运行时**：反射读注解（灵活但慢、要 keep）。  
3. **字节码**：ASM/AspectJ 等。  
4. 面试对比：编译期生成通常更适合 Android 性能与混淆。

---
