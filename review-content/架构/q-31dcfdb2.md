---
id: q-31dcfdb2
type: qa
module: architecture
knowledge_ref: kp-router
title: 路由大致原理？
priority: P0
version: 1
---

## 问题
路由大致原理？

## 答案
1. 编译期注解收集路由表（APT/KSP）或运行时注册。  
2. 启动时装载 path → 目标（Activity/Fragment/服务）。  
3. `navigate(path)` 查表 → 拦截器链 → 启动组件。  
4. 参数注入、降级页、登录拦截常见。

---
