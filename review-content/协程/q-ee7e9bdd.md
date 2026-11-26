---
id: q-ee7e9bdd
type: qa
module: coroutine
knowledge_ref: kp-coroutine-dispatchers
title: Dispatcher 有哪些？怎么选？
priority: P0
version: 1
---

## 问题
Dispatcher 有哪些？怎么选？

## 答案
| Dispatcher | 用在哪 | 背后大概 |
|------------|--------|----------|
| `Main` | UI、改 View | 主线程 |
| `IO` | 网络、磁盘、数据库 | 共享 IO 线程池（可扩） |
| `Default` | 排序、解析、重计算 | CPU 密集，约核数 |
| `Unconfined` | 几乎别用 | 难推理 |
| 自定义 | `executor.asCoroutineDispatcher()` | 你自己的线程池 |

**选：** UI→Main；网络文件→IO；纯计算→Default；要限流→自建固定池或 Semaphore。

---
