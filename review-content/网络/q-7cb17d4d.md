---
id: q-7cb17d4d
type: qa
module: network
knowledge_ref: kp-okhttp
title: OkHttp 核心能力与拦截器链？
priority: P0
version: 1
---

## 问题
OkHttp 核心能力与拦截器链？

## 答案
1. 连接池、拦截器、重试重定向、缓存、透明 GZIP 等。  
2. 链：应用拦截器 → 重试/重定向 → Bridge → Cache → Connect → 网络拦截器 → CallServer。  
3. 超时：call/connect/read/write。  
4. 事件监听、证书、代理、HTTP/2。

---
