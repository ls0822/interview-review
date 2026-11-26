---
id: kp-network-roadmap
type: knowledge
module: network
title: 网络掌握地图与复习顺序（专家）
priority: P0
version: 2
order: 1
---

## 一句话

网络面试从「字节怎么可靠到达」走到「TLS 信谁、DNS 解析到哪、长连接怎么保活、客户端库怎么并发」；每一层都能说清失败时长什么样，而不是背端口号。

**P0** TCP/UDP 取舍、HTTPS 握手与证书、OkHttp 调用链。**专家加分** QUIC 0-RTT 边界、弱网优化指标、与 WebSocket 混排场景。

## 组成与结构

| 层 | 要回答的问题 | 主篇 | 档 |
|----|----------------|------|----|
| 可靠传输 | 三次握手、重传、滑动窗口 | `kp-tcp` | P0 必会 |
| 无连接报文 | UDP 适用、与 TCP 对比 | `kp-udp` | P0 必会 |
| 密码学底座 | 对称/非对称、摘要 | `kp-crypto-basic` | P0 必会 |
| TLS 与证书 | 链、 pinning、中间人 | `kp-https-cert` | P0 必会 |
| 名字解析与边缘 | DNS、CDN 命中 | `kp-dns-cdn` | P0 必会 |
| HTTP 客户端 | 连接池、拦截器、Dispatcher | `kp-okhttp` | P0 必会 |
| QUIC / HTTP3 | 相对 TCP+TLS 的差异句 | `kp-quic` | 专家加分 |
| WebSocket | 升级、帧、与 HTTP 长轮询 | `kp-websocket` | P0 必会 |
| 长连接治理 | 心跳、重连、前后台 | `kp-long-connection` | P0 必会 |
| 弱网与性能 | 超时、重试、压缩、监控 | `kp-net-optimize` | P0 必会 |

P0：

- TCP 可靠有序、全双工；UDP 不保证、低延迟场景。
- HTTPS = HTTP over TLS；证书校验失败必须 fail closed。
- OkHttp 同 host 连接复用；拦截器顺序决定观测与改请求。

专家加分：

- QUIC 连接迁移；HTTP/2 多路复用与队头阻塞。
- RTT、带宽时延积与超参数。

## 原理

这一节从传输到应用客户端，每层说清「正常路径、失败长什么样、和易混层差别」。

### 1. TCP 可靠性与状态（P0 必会）

三次握手建立全双工字节流；seq/ack 与滑动窗口做重传、拥塞控制。半关闭：`FIN` 一方说完，另一方可继续发。`RST` 粗暴重置，上层可能收到 reset by peer。对比 UDP：无连接、不保序、适合实时可丢包容忍。移动端 NAT 空闲会丢映射，长连接靠 keepalive/心跳——不是 TCP 内置业务心跳。失败模式：把「连上」当「对端进程就绪」，应用层还要自己的握手。见 `kp-tcp`、`kp-udp`。

### 2. TLS、证书与信任链（P0 必会）

HTTPS = HTTP over TLS。握手协商密码套件与会话密钥；证书链须落到系统/预埋信任锚。hostname 校验防错配；证书固定（pin）防恶意 CA 或中间人——pin 过期要自己发版更新。失败必须 fail closed：继续连等于把明文交给攻击者。与「仅加密无校验」对比：自签在实验环境可以，生产不行。见 `kp-https-cert`、`kp-crypto-basic`。

### 3. DNS、CDN 与首包路径（P0 必会）

DNS 把名字解析成地址；缓存 TTL、运营商劫持、HTTPDNS 与系统解析结果可能不一致。CDN 把静态/边缘计算推到离用户近的节点，回源失败要有降级。连接建立顺序常是：解析 → TCP → TLS → HTTP 请求。弱网时 DNS 超时与 TCP 超时叠加，指标要看分阶段 RTT。见 `kp-dns-cdn`。

### 4. HTTP 客户端与连接复用（P0 必会）

同 host 连接池复用 TCP+TLS 会话，减少握手。`Dispatcher` 限制同域并发，避免把服务器或本地线程打满。拦截器链：应用拦截器改请求/观测；网络拦截器接近 socket。同步 `execute` 阻塞调用线程；协程用 suspend 适配时仍占连接池与 IO 配额。失败模式：每请求 new 一个 `OkHttpClient` 丢复用。见 `kp-okhttp`。

### 5. QUIC / HTTP3 边界（专家加分）

QUIC 在用户态把传输与加密揉合，0-RTT 有重放风险要业务幂等。与 TCP+TLS 对比：队头阻塞在连接级缓解，迁移连接需连接 ID。移动端普及度因机型与中间盒而异，面试给机制句即可。见 `kp-quic`。

### 6. WebSocket 与长连接治理（P0 必会）

HTTP 升级后全双工帧；心跳、ping/pong、空闲断开各协议略有差异。前后台切换要降频或断连省电量，回来要状态同步（`kp-long-connection`）。与长轮询对比：轮询浪费 RTT，WebSocket 省头但占连接与状态机。失败模式：无退避重连风暴打穿网关。见 `kp-websocket`、`kp-long-connection`。

### 7. 弱网、重试与幂等（P0 必会）

超时、重试、退避+jitter 是客户端三件套；**只有幂等**请求才适合自动重试 POST 以外也要看业务。GZIP/图片采样/缓存头在优化层收口。指标：成功率、P95 耗时、重试率、离线队列积压。见 `kp-net-optimize`。

## 使用与实践

严格按 order 递增复习；`kp-udp` 在 `kp-tcp` 后对比读，`kp-quic` 在 TCP+TLS 都懂后再读。

1–5：传输与安全底座 → 6：`kp-okhttp` 串拦截器 → 7–9：实时与长连 → 10：`kp-net-optimize` 指标收口。

串讲：App 启动拉配置—DNS—TLS—HTTP/2—缓存；弱网重试幂等；登录后 WebSocket 心跳与退后台挂起。

## 例子

```text
错：任意重试 POST 支付 → 重复扣款
对：幂等键 + 仅 idempotent 方法自动重试
错：忽略证书错误继续连 → MITM
对：失败即断，pin 更新走发版通道
```

## 画面

```text
tcp ---- udp
  |
crypto -> https-cert -> dns-cdn
  |
okhttp ---- quic (可选加深)
  |
websocket -> long-connection -> net-optimize
```

## 常见坑与追问

1. **以为 HTTPS 等于「加密就不用校验证书」。** 追问：pin 过期怎么办？
2. **TCP 和 HTTP 长连接混为一谈。** 追问：连接池 idle 超时？
3. **WebSocket 当万能推。** 追问：服务端下行-only 用 SSE？
4. **重试无退避风暴。** 追问：503 时 jitter？
5. **DNS 缓存陈旧。** 追问：切换 Wi-Fi/4G 解析变化？
