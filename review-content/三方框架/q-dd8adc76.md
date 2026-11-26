---
id: q-dd8adc76
type: qa
module: framework
knowledge_ref: kp-image-loader
title: 网络 / 异步 / 存储常搭什么？
priority: P1
version: 1
---

## 问题
网络 / 异步 / 存储常搭什么？

## 答案
1. 网络：OkHttp + Retrofit  
2. 异步：协程 + Flow；老 RxJava  
3. 存储：Room / DataStore / MMKV  
4. 图片：Glide/Coil  
5. JSON：Gson / Moshi / kotlinx.serialization  

会对比「为何选」即可，不必每个都用过吹精通。

---
