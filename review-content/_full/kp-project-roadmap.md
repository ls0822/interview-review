---
id: kp-project-roadmap
type: knowledge
module: project
title: 项目口述掌握地图与复习顺序（专家）
priority: P0
version: 2
order: 1
---

## 一句话

项目面试用「我负责哪条链路、难点在哪、指标怎么量化、兜底怎么设计」回答；本篇把 IM、直播底座、离线/上传三条业务线排成复习线，每条都能扣回架构与网络知识点。

**P0** 三条线各自的架构决策与故障故事。**专家加分**是多端一致、灰度与版本回滚话术。

## 组成与结构

| 层 | 要回答的问题 | 主篇 | 档 |
|----|----------------|------|----|
| IM 实时 | 长连、已读、未读、消息序 | `kp-project-im` | P0 必会 |
| 直播底座 | 推拉流、房间状态、弱网 | `kp-project-live-base` | P0 必会 |
| 离线与上传 | 断点续传、前后台、队列 | `kp-project-offline-upload` | P0 必会 |

先修链已在各篇：`kp-long-connection`、`kp-sdk-api`、`kp-compose-interop` 等——口述时主动点名「当时对应哪篇原理」。

P0：

- IM：WebSocket/MQTT 类长连 + 本地库 + 幂等 id；序与去重。
- 直播：信令与媒体分离；SDK 边界与 `kp-sdk-api` 风格一致。
- 上传：分片、重试、后台 WorkManager vs 前台通知权衡。

专家加分：

- 多端漫游与冲突解决；服务端权威 vs 客户端合并。
- 弱网 KPI：首帧、卡顿率、发送成功率。

## 原理

这一节把三条业务线的「端到端因果、一致性、生命周期、模块边界、指标」讲到能扛追问。

### 1. 端到端故事线与状态机（P0 必会）

用户动作触发客户端状态机（连接中/同步中/失败重试），经网络到达服务端，再异步回落 UI。面试用一条时序：点发送→本地入队→长连接帧→服务端序→ ack → 更新会话列表。与纯 REST 拉取对比：实时线要处理**在线与离线两套路径**。失败模式：只画 happy path，追问「断网重连后消息重复」答不出。见 `kp-project-im`、`kp-long-connection`。

### 2. 一致性与幂等（P0 必会）

客户端 `clientMsgId` 去重；服务端 seq/版本权威。乐观 UI 先展示 sending，失败回滚或标 failed 可重试。多端漫游：以服务端游标为准，本地 gap fill。与分布式 CAP 口述：移动端选可用+最终一致常见。失败模式：只用时间戳排序，时钟偏导致乱序。上传分片要带 chunkId 与整体 digest，续传避免重复块。

### 3. 直播：信令与媒体分离（P0 必会）

信令走 TCP/WebSocket；媒体走 UDP/专用 SDK 通道。房间状态（进房、禁言、麦位）与码率自适应分开治理。弱网降码率、缓冲、首帧时间与 UI 提示要对齐口径，不只说「CDN 问题」。失败模式：主线程预览回调里做重计算卡预览。见 `kp-project-live-base`。

### 4. 离线上传与系统策略（P0 必会）

大文件分片、断点续传、前后台切换：WorkManager 约束网络/充电 vs 前台服务保活通知。Wi-Fi only 策略与用户「仍要上传」例外要产品+技术共识。与 `kp-project-offline-upload`、`kp-service-bg` 对齐。失败模式：后台静默上传被系统杀，无重试队列无指标。

### 5. 模块化与 SDK 边界（P0 必会）

IM 内核 SDK 对外稳定 API（`kp-sdk-api`），UI feature 经 `kp-router` 跳转。依赖方向：业务 feature 不互引 Activity。面试说清楚你负责的 module 边界与对外契约。失败模式：口述「我做了整个 App」无法下钻到一条链路。

### 6. 可观测与 STAR 指标（P0 必会）

连接成功率、重连次数、消息端到端延时 P95、上传成功率、首帧时间、卡顿率——口径要写清（分母、采样、版本）。优化前后对比要比相对值+绝对值。专家：灰度回滚与 feature flag 如何救一次发版事故。

## 使用与实践

1. `kp-project-im` — STAR：最难 bug 与修复。
2. `kp-project-live-base` — 卡顿排查路径。
3. `kp-project-offline-upload` — 大文件失败率优化。

每篇准备：背景 20 秒、你的职责 40 秒、技术决策 60 秒、结果指标 20 秒。

交叉复习：`kp-network-roadmap` 长连段、`kp-architecture-roadmap` SDK 段。

## 例子

```text
【IM 发送】
错：仅信服务端 push，本地无 clientMsgId → 重连后同一条显示两次；问「怎么去重」答不出字段设计。
对：发送前生成 clientMsgId 入本地 DB（sending），ack 后改 sent；收包用 (conversationId, serverSeq) 去重 + 漫游补洞。

【离线上传】
错：Activity 里 Thread 直传大文件，退后台即杀，无续传；用户见「上传失败」但日志无 requestId。
对：分片 + 断点表 + WorkManager（或合规前台服务），失败指数退避；埋点 successRate 与 P95 耗时。

【直播弱网】
错：卡顿只调低 UI 动画，码率固定 → 首帧 8s 仍卡住，复盘说「CDN 不稳定」无量化。
对：SDK 回调码率/缓冲水位驱动 UI 与自动降档，指标首帧/卡顿率前后对比有版本与样本量。
```

## 画面

```text
project-im (实时消息)
      |
project-live-base (房间/媒体)
      |
project-offline-upload (可靠性)
      |
共性: sdk-api + long-connection + 架构分层
```

## 常见坑与追问

1. **只讲需求不讲你的决策。** 追问：为什么不换另一种协议？
2. **指标模糊「优化了很多」。** 追问：数字与口径？
3. **把团队成果全揽。** 追问：你具体写了哪块？
4. **回避失败案例。** 追问：上线后最严重事故？
5. **技术栈罗列无链路。** 追问：从点到点 walkthrough？