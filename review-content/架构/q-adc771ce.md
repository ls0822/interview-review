---
id: q-adc771ce
type: qa
module: architecture
knowledge_ref: kp-arch-patterns
title: 常见方案对比？
priority: P0
version: 1
---

## 问题
常见方案对比？

## 答案
| 方案 | 特点 |
|------|------|
| ARouter | 阿里开源，注解+APT，拦截器，应用广 |
| 官方 Navigation | 单 Activity 多 Fragment 友好，与组件化跨 module 需配合 |
| 自研 | 可控、贴业务；成本高 |
| 隐式 Intent | 系统级，粗，难管复杂参数与组件化治理 |
| DeepLink / AppLink | 外链进入，常与路由统一处理 |

**对比维度：** 跨 module、性能（表加载）、混淆、拦截器、维护状态、学习成本、是否支持 Fragment/服务。

---
