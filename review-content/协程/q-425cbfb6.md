---
id: q-425cbfb6
type: qa
module: coroutine
knowledge_ref: kp-coroutine-flow
title: 冷流 vs 热流？（一定要说清）
priority: P0
version: 1
---

## 问题
冷流 vs 热流？（一定要说清）

## 答案
| | 冷流 Cold | 热流 Hot |
|--|-----------|----------|
| 何时开始产数据 | **有人 collect 才开始** | 自己可能一直在产（或共享一个上游） |
| 多个收集者 | 通常**各自跑一遍**上游 | **共享**同一份数据源 |
| 像什么 | 点播视频：每人打开各自播 | 直播：台上一直演，你晚进就错过 |
| 例子 | `flow { }`、`flowOf`、多数 Retrofit+Flow | `StateFlow`、`SharedFlow`、`LiveData`（也偏热） |

**口诀：** 冷流「一人一份从头演」；热流「台上演，观众可晚到」。

---
