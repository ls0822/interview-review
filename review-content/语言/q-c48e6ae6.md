---
id: q-c48e6ae6
type: qa
module: language
knowledge_ref: kp-oop-basics
title: 栈溢出 OOM 区别？
priority: P1
version: 1
---

## 问题
栈溢出 OOM 区别？

## 答案
1. StackOverflowError：递归过深等栈帧过多。  
2. OutOfMemoryError：堆/元空间不足等。  
3. Android 还有显存/fd 等，分析用 Profiler、hprof。

---

## 本节自测

- [ ] 混编 5 大坑能口述  
- [ ] 线程池流程 + 无界队列坑  
- [ ] 自定义注解三要素 + APT vs 反射  
- [ ] JVM 堆栈方法区 + 双亲委派
