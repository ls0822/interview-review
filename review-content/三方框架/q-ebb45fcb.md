---
id: q-ebb45fcb
type: qa
module: framework
knowledge_ref: kp-image-loader
title: 三级缓存怎么说？
priority: P0
version: 1
---

## 问题
三级缓存怎么说？

## 答案
1. **内存**：最快，LRU；注意大小与页面销毁回收。  
2. **磁盘**：持久；关键淘汰。  
3. **网络**：最慢；写回磁盘/内存。  
4. 查询顺序：内存 → 磁盘 → 网络。

---
