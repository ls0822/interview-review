---
id: q-5ce7e6ca
type: qa
module: language
knowledge_ref: kp-oop-basics
title: JVM 内存区域（面试版）？
priority: P0
version: 1
---

## 问题
JVM 内存区域（面试版）？

## 答案
1. **堆 Heap**：对象实例；GC 主战场。  
2. **方法区/元空间**：类元信息（Java8+ Metaspace 本地内存）。  
3. **栈**：线程私有，栈帧（局部变量、操作数栈）。  
4. **程序计数器**、**本地方法栈**。  
5. Android 跑在 ART 上，但面试常按 JVM 模型答，可补一句 ART/AOT/JIT。

---
