---
id: q-6eeda393
type: qa
module: language
knowledge_ref: kp-annotations-exceptions
title: 异常处理最佳实践（面试版）？
priority: P1
version: 1
---

## 问题
异常处理最佳实践（面试版）？

## 答案
1. 不要空 catch；不要吞掉后无日志。  
2. 层次：可恢复 vs 不可恢复；边界转错误码/Result。  
3. finally / use 关资源；协程注意取消与关闭。  
4. SDK：对客户暴露稳定错误码，内部打点。

---
