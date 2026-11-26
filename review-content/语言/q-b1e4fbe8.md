---
id: q-b1e4fbe8
type: qa
module: language
knowledge_ref: kp-classloader
title: 类加载过程？双亲委派？
priority: P1
version: 1
---

## 问题
类加载过程？双亲委派？

## 答案
1. 加载 → 链接（验证、准备、解析）→ 初始化。  
2. **双亲委派**：先让父加载器尝试，避免核心类被篡改、保证唯一性。  
3. Android：PathClassLoader/DexClassLoader；热修/插件会破委派（面试提风险与政策）。

---
