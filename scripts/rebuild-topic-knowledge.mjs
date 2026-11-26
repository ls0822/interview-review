/**
 * 重建题库：
 * - 知识点 = 主题解剖（组成/原理/使用/例子/画面），标题不是问句
 * - 问答 = 仅提问形式，并挂到主题知识点
 *
 * node scripts/rebuild-topic-knowledge.mjs && npm run content
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const reviewRoot = path.resolve(root, '..', '复习')
const outRoot = path.join(root, 'review-content')

function readReview(rel) {
  return fs.readFileSync(path.join(reviewRoot, rel), 'utf8')
}
function write(rel, text) {
  const p = path.join(outRoot, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text.trimStart())
}
function hash(s) {
  return createHash('md5').update(s).digest('hex').slice(0, 8)
}

function extractQAs(md) {
  const parts = md.split(/\n(?=###\s+Q\d+[a-z]?\.)/)
  const items = []
  for (const part of parts) {
    const m = part.match(/^###\s+(Q\d+[a-z]?)\.\s*(.+?)\s*\n([\s\S]*)$/)
    if (!m) continue
    const rawTitle = m[2].trim()
    const priority = (rawTitle.match(/·\s*(P[012])\s*$/) || [])[1] || 'P1'
    const title = rawTitle.replace(/\s*·\s*P[012]\s*$/, '').trim()
    const answer = m[3].replace(/^\*\*A[：:]\*\*\s*/m, '').trim()
    items.push({ qid: m[1], title, priority, answer })
  }
  return items
}

function extractSections(md) {
  const lines = md.split(/\n/)
  const sections = []
  let cur = null
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)\s*$/)
    if (m) {
      if (cur) sections.push(cur)
      cur = { title: m[1].replace(/^\d+\.\s*/, '').trim(), body: [] }
      continue
    }
    if (cur) cur.body.push(line)
  }
  if (cur) sections.push(cur)
  return sections
    .map((s) => ({ title: s.title, body: s.body.join('\n').trim() }))
    .filter((s) => s.body.length > 120)
    .filter((s) => !/[？?]$/.test(s.title))
    .filter((s) => !/自测|总览|怎么复习|口述|建议学习|进度勾选/.test(s.title))
}

/** 把多段材料收成主题知识点 */
function topicDoc({ id, module, folder, title, priority = 'P0', parts }) {
  const {
    one = title,
    structure = '',
    principle = '',
    usage = '',
    example = '',
    diagram = '',
    pitfalls = '',
    raw = '',
  } = parts

  const body = `## 一句话

${one}

## 组成与结构

${structure || '见下方原理与材料拆解。'}

## 原理

${principle || raw || '见详细材料。'}

## 使用与实践

${usage || '结合项目场景口述：什么时候用、怎么初始化、回调在哪个线程、如何释放。'}

## 例子

${example || '面试时准备一个最小例子：正常路径 + 失败/边界路径。'}

## 画面

\`\`\`text
${diagram || `${title}\n  ├─ 组成\n  ├─ 关键路径\n  └─ 坑`}
\`\`\`

## 常见坑与追问

${pitfalls || '能说出 1～2 个线上坑或取舍即可。'}
`

  write(
    `${folder}/${id}.md`,
    `---
id: ${id}
type: knowledge
module: ${module}
title: ${title.replace(/"/g, "'")}
priority: ${priority}
version: 1
---

${body}
`,
  )
}

// —— 清空旧目录 ——
for (const name of fs.readdirSync(outRoot)) {
  const p = path.join(outRoot, name)
  if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true })
}

const MODULES = [
  ['project', '项目口述', 0],
  ['coroutine', '协程', 1],
  ['concurrent', '并发', 2],
  ['jvm', 'JVM', 3],
  ['language', '语言', 4],
  ['android', 'Android', 5],
  ['network', '网络', 6],
  ['architecture', '架构', 7],
  ['compose', 'Compose', 8],
  ['framework', '三方框架', 9],
  ['agent', 'Agent', 10],
  ['algo', '算法', 90],
]
write(
  'modules.yaml',
  MODULES.map(([id, name, order]) => `- id: ${id}\n  name: ${name}\n  order: ${order}`).join('\n') + '\n',
)

// ========== 主题知识点（系统解剖）==========

// —— Android: Handler ——
topicDoc({
  id: 'kp-handler-system',
  module: 'android',
  folder: 'Android',
  title: 'Handler 消息机制',
  parts: {
    one: 'Handler / Looper / MessageQueue 组成一套线程内消息循环，用来做线程切换与延迟任务。',
    structure: `三件套：

1. **Looper**：每条线程最多一个；\`loop()\` 死循环取消息。主线程在启动时已 \`prepareMainLooper\`。
2. **MessageQueue**：按时间排序的消息队列；\`next()\` 无消息时阻塞等待。
3. **Handler**：绑定某个 Looper；\`sendMessage\` / \`post\` 把消息入队；\`dispatchMessage\` 执行。
4. **Message**：可带 what/arg/obj/callback；有复用池，避免狂分配。`,
    principle: `主线程路径：

1. \`ActivityThread\` 起主线程 Looper。
2. 任意线程拿到主线程 Handler，把 Message 丢进主线程 MessageQueue。
3. Looper 取出后调用 \`Handler.dispatchMessage\`：
   - 若 Message.callback 非空（post(Runnable)）→ 直接跑 Runnable
   - 否则 \`handleMessage\`

同步屏障：队列插入无 target 的屏障后，优先处理异步消息；Choreographer 用它保证 VSYNC/绘制不被普通消息堵死。业务不要自己插屏障。

IdleHandler：队列暂时空闲时回调，适合首帧后延迟初始化，里面不要做重活。`,
    usage: `常见用法：

- 子线程更新 UI：\`mainHandler.post { ... }\`
- 延迟/轮询：\`postDelayed\`，页面销毁必须 \`removeCallbacksAndMessages(null)\`
- 子线程自己处理消息：\`Looper.prepare()\` → \`Handler\` → \`Looper.loop()\`，或 \`HandlerThread\`
- 选型：长时间后台队列用 HandlerThread；新代码更多用协程；跨进程别用 Handler`,
    example: `\`\`\`kotlin
// 主线程 Handler
val handler = Handler(Looper.getMainLooper())
thread {
  val data = load()
  handler.post { textView.text = data }
}

// 防泄漏：销毁时清空
override fun onDestroy() {
  handler.removeCallbacksAndMessages(null)
  super.onDestroy()
}
\`\`\`

泄漏链：MessageQueue → Message → Handler(非静态内部类) → Activity。`,
    diagram: `Thread
  └─ Looper.loop()
        └─ MessageQueue.next()
              └─ msg.target.dispatchMessage(msg)
                    ├─ callback.run()   // post
                    └─ handleMessage() // sendMessage`,
    pitfalls: `- 非静态内部类 Handler 泄漏 Activity
- 只 WeakReference 不够，还要移除未执行消息
- 在主线程 post 了重任务一样 ANR
- IntentService 已过时，新项目优先协程 / WorkManager`,
  },
})

topicDoc({
  id: 'kp-activity-lifecycle',
  module: 'android',
  folder: 'Android',
  title: 'Activity 启动模式与生命周期',
  parts: {
    one: '启动模式决定实例是否复用；生命周期要分清前台、旋转重建、进程被杀三件事。',
    structure: `四种 launchMode：standard / singleTop / singleTask / singleInstance。
生命周期：onCreate → onStart → onResume → onPause → onStop → onDestroy。`,
    principle: `startActivity 面试版：App → AMS（跨进程）→ 栈管理/可能建进程 → 回调应用进程 → Instrumentation 走生命周期。

旋转：默认销毁重建，ViewModel 仍在。
进程被杀：ViewModel 没了，只靠 savedInstanceState / SavedStateHandle 恢复轻量状态；长连接要重连。

寿命分层：局部变量 < remember < ViewModel < rememberSaveable。`,
    usage: `主页/推送落地常用 singleTask 或 singleTop。
复用时走 onNewIntent，记得 setIntent。
透明弹窗盖住时，底下可能只有 onPause 不到 onStop。`,
    example: `\`\`\`text
standard     每次 new
singleTop    仅栈顶复用 → onNewIntent
singleTask   栈内复用并清其上 → onNewIntent
singleInstance 独占任务栈
\`\`\``,
    diagram: `前台：Create-Start-Resume
旋转：旧 Destroy，新 Create；ViewModel 留
杀进程：一切内存没，Bundle 小状态可恢复`,
    pitfalls: 'singleTask 会清掉上面页面；remember 不防旋转；划掉任务不保证恢复。',
  },
})

topicDoc({
  id: 'kp-touch-dispatch',
  module: 'android',
  folder: 'Android',
  title: '触摸事件分发与滑动冲突',
  parts: {
    one: '事件按 分发 → 拦截 → 消费 向下走，再视情况回传。',
    structure: 'Activity → ViewGroup → … → View。ViewGroup 独有 onInterceptTouchEvent。',
    principle: `dispatchTouchEvent 收到事件；
ViewGroup 可在 onInterceptTouchEvent 截胡；
onTouchEvent 返回 true 表示消费。
子可通过 requestDisallowInterceptTouchEvent(true) 让父先别拦。`,
    usage: '父横滑子竖滑：父看位移方向决定是否拦截，或子确认纵向后禁止父拦截。',
    example: '外部拦截：父根据 dx/dy；内部拦截：子 requestDisallowInterceptTouchEvent。',
    diagram: `dispatchTouchEvent
   ↓
onInterceptTouchEvent? --是--> 自己 onTouchEvent
   ↓否
子 View 分发 / 消费`,
    pitfalls: 'OnTouchListener 返回 true 可能导致点不到 onClick。',
  },
})

topicDoc({
  id: 'kp-service-bg',
  module: 'android',
  folder: 'Android',
  title: 'Service 与后台限制',
  parts: {
    one: 'Service 分 start 与 bind；后台启动受限，持续工作用前台服务并声明类型。',
    structure: 'startService / startForegroundService；bindService 返回 Binder；可同时 start+bind。',
    principle: 'Android 8+ 后台不能随意 startService。前台服务必须通知，高版本要 foregroundServiceType。',
    usage: 'IM 长连接讲合规：前台服务条件、断线重连退避；别吹双进程保活。',
    example: '通话/播放用前台服务；离开页面还要传完的文件用 WorkManager 或自研队列。',
    diagram: `start → 独立活到 stop
bind  → 有客户端绑定
后台限制 → 前台服务(通知+类型)`,
    pitfalls: 'CallerRuns 式重活跑回主线程会 ANR；保活手段审核风险。',
  },
})

topicDoc({
  id: 'kp-anr',
  module: 'android',
  folder: 'Android',
  title: 'ANR 机制与排查',
  parts: {
    one: '主线程在时限内没处理完输入/广播/服务等，系统记 ANR 并抓栈。',
    structure: '输入约 5s；前台广播约 10s；前台 Service 约 20s（约数，随版本变）。',
    principle: '看 traces 主线程栈：业务重活、等锁、卡在 Binder transact。',
    usage: '主线程只调度；网络磁盘解码进 IO；SDK 同步 API 必须写明线程。',
    example: '栈在 parseJson=自己重；monitor contention=等锁；Binder transact=等别的进程。',
    diagram: `输入/超时 → 系统抓主线程栈 → 分类：重活/锁/Binder`,
    pitfalls: '队列前面慢消息也会拖死后面的点击，栈可能已不在慢消息里。',
  },
})

// —— 网络主题 ——
topicDoc({
  id: 'kp-tcp',
  module: 'network',
  folder: '网络',
  title: 'TCP 协议',
  parts: {
    one: 'TCP 面向连接，可靠、有序，带拥塞控制，适合 HTTP/IM 长连接等。',
    structure: '三次握手建连、四次挥手释放；序号/确认号；滑动窗口；拥塞控制。',
    principle: `握手：SYN → SYN+ACK → ACK，同步初始序号并确认双向可达。
挥手：FIN → ACK → FIN → ACK，支持半关闭；主动方常有 TIME_WAIT。
可靠：丢包重传、有序交付。`,
    usage: 'Android 上经 Socket/OkHttp；长连接要心跳探测死连接。',
    example: 'IM 长连接基于 TCP（或 WS over TCP）；上传下载走 HTTPS/TCP。',
    diagram: `Client                 Server
  |------ SYN --------→|
  |←--- SYN+ACK -------|
  |------ ACK --------→|
     连接建立，开始传数据`,
    pitfalls: '队头阻塞：一包丢了，同连接后续也等；HTTP/2 仍受 TCP 层影响，QUIC 改善这一点。',
  },
})

topicDoc({
  id: 'kp-udp',
  module: 'network',
  folder: '网络',
  title: 'UDP 协议',
  parts: {
    one: 'UDP 无连接、尽力交付，头开销小，适合实时性优先或自建可靠层的场景。',
    structure: '无握手；无内建重传/拥塞（应用可自建）；可广播/多播（视环境）。',
    principle: '发了就完，乱序丢包由上层处理。RTC、DNS 查询、QUIC 底座常见。',
    usage: '音视频可走 UDP；要可靠就在应用层做 ACK/重传，或改用 TCP/QUIC。',
    example: 'DNS 查询用 UDP；直播/RTC 常 UDP；HTTP/3 跑在 QUIC（UDP）上。',
    diagram: `发送方 ──UDP datagram──▶ 接收方
无连接、可能丢、可能乱序`,
    pitfalls: '别在需要强可靠且不想自建协议时硬用裸 UDP。',
  },
})

topicDoc({
  id: 'kp-https-cert',
  module: 'network',
  folder: '网络',
  title: 'HTTPS 与数字证书',
  parts: {
    one: 'HTTPS = HTTP + TLS。证书证明公钥归属，防中间人；对称加密传数据。',
    structure: `证书含：域名、公钥、有效期、CA 签名等。
信任链：站点证 → 中间 CA → 根 CA（系统/自定义信任库）。`,
    principle: `握手概要：
1. 校验证书链、域名、有效期、吊销策略（视实现）
2. 密钥交换（非对称/ECDHE 等）得到会话密钥
3. 之后用对称加密（AES 等）传应用数据

抓包：需信任用户 CA；Certificate Pinning 只信指定公钥/证。`,
    usage: '全站 HTTPS；IP 直连时注意 SNI 与 Host；Pinning 换证要有更新策略。',
    example: '浏览器/系统校验证书链；App 可再做公钥锁定。离线包下载走 HTTPS+CDN。',
    diagram: `客户端                     服务端
  |←—— 证书(公钥) ————|
  |   校验 CA 链/域名   |
  |—— 密钥交换/握手 ——→|
  |←—— 对称加密通信 ——→|`,
    pitfalls: '只 MD5 当密码哈希不够；证书过期；Pinning 太死导致换证全军覆没。',
  },
})

topicDoc({
  id: 'kp-quic',
  module: 'network',
  folder: '网络',
  title: 'QUIC 与 HTTP/3',
  parts: {
    one: 'QUIC 基于 UDP，集成加密，降低建连时延，改善弱网与连接迁移；HTTP/3 跑在其上。',
    structure: '0/1-RTT 建连；流多路复用且减少 TCP 式队头阻塞；连接迁移（换网）。',
    principle: '自带类似 TLS 的安全；丢包主要影响对应 stream。',
    usage: 'Android 可用 Cronet/系统栈；面试对比 TCP+HTTP/2 即可。',
    example: '弱网或频繁切换网络的场景收益更明显。',
    diagram: `HTTP/3
  └─ QUIC
       └─ UDP`,
    pitfalls: '企业网/防火墙可能对 UDP 不友好，要有降级。',
  },
})

topicDoc({
  id: 'kp-long-connection',
  module: 'network',
  folder: '网络',
  title: '长连接设计（心跳、重连、可靠性）',
  parts: {
    one: '长连接 = 建连鉴权后保持通道；用心跳探活，用退避重连，用 Ack/序号保证消息可靠。',
    structure: '连接状态机；心跳定时器；发送队列；Ack/超时重试；接收去重排序；补拉。',
    principle: `死连接：中间设备掐流但两端不知 → 心跳超时关闭再重连。
重连：指数退避 + 抖动，监听网络变化，防重连风暴。
可靠：本地先落库/上屏 → 发送中 → Ack；失败入队；接收按会话序号去重。`,
    usage: '挂钩融云 IM、快传 IM2.0、直播信令。界面不要死等 Ack 才显示。',
    example: `发送状态机：本地插入 → 发送中 → 成功 / 失败重试
断网：回调 → 退避重连 → 序号补洞`,
    diagram: `DNS/接入 → 建连 → 鉴权 → 同步
              ↓
           心跳保活
         ↙        ↘
       发+Ack      收+去重排序`,
    pitfalls: '粘包要应用层拆；无界发送队列会撑爆内存；重连无抖动打爆服务器。',
  },
})

topicDoc({
  id: 'kp-websocket',
  module: 'network',
  folder: '网络',
  title: 'WebSocket 与 Socket',
  parts: {
    one: 'Socket 是传输端点抽象；WebSocket 是 HTTP 升级后的全双工帧协议，穿透友好。',
    structure: '裸 TCP Socket；WebSocket 帧；与 HTTP 轮询对比。',
    principle: 'WS 握手走 HTTP，之后双工；代理/防火墙往往比裸 TCP 友好。',
    usage: '选型看可靠性方案、可达性、耗电、包头、是否已有网关。',
    example: 'IM 可见自研 TCP 或 WS；信令也可用 WS。',
    diagram: `HTTP 升级握手 → WebSocket 全双工帧
TCP Socket → 自定义协议(长度头+body)`,
    pitfalls: 'TCP 粘包：长度头/分隔符/定长；读写超时都要设。',
  },
})

topicDoc({
  id: 'kp-okhttp',
  module: 'network',
  folder: '网络',
  title: 'OkHttp 拦截器与连接池',
  parts: {
    one: 'OkHttp 是 Android HTTP 事实标准：连接池、拦截器链、重试、缓存、HTTP/2。',
    structure: '应用拦截器 → 重试/重定向 → Bridge → Cache → Connect → 网络拦截器 → CallServer。',
    principle: '连接复用减少握手；超时分 call/connect/read/write；事件监听可做监控。',
    usage: 'Retrofit 底下常是 OkHttp。长连接若是自研 Socket，别和短请求池混为一谈。',
    example: '加日志拦截器、Token 拦截器；按业务设超时。',
    diagram: `Request
  → App Interceptor
  → Retry/Redirect
  → Bridge / Cache / Connect
  → Network Interceptor
  → Server`,
    pitfalls: '主线程发同步请求；超时过长拖垮体验；缓存策略不清导致脏数据。',
  },
})

topicDoc({
  id: 'kp-dns-cdn',
  module: 'network',
  folder: '网络',
  title: 'DNS、HTTPDNS 与 CDN',
  parts: {
    one: 'DNS 把域名变 IP；HTTPDNS 防劫持/更快；CDN 边缘缓存加速下载。',
    structure: '系统 DNS；HTTPDNS；多 IP；CDN 边缘节点与回源。',
    principle: '劫持/慢解析用 HTTPDNS；IP 直连要处理 HTTPS 的 Host/SNI/证书域名。',
    usage: '图片/离线包走 CDN；监控解析耗时与下载成功率。',
    example: '离线资源包 CDN + 差分；失败切备用域名。',
    diagram: `App → HTTPDNS → IP
App → CDN 边缘 → (未命中)回源`,
    pitfalls: '证书域名与 IP 直连不匹配；CDN 时间戳防盗链过期。',
  },
})

topicDoc({
  id: 'kp-crypto-basic',
  module: 'network',
  folder: '网络',
  title: '对称加密、非对称加密与摘要',
  parts: {
    one: '对称快但密钥分发难；非对称用于交换/签名；摘要做完整性，密码存储要慢哈希加盐。',
    structure: 'AES 等对称；RSA/ECC 非对称；MD5/SHA 摘要；HTTPS 组合使用。',
    principle: 'HTTPS：握手阶段认证与密钥交换，业务数据对称加密。',
    usage: '离线包可加密；上传 MD5 采样校验；密钥勿硬编码。',
    example: 'TLS 握手后 AES 传数据；文件完整性用 SHA-256。',
    diagram: `非对称：交换/签名
对称：大批量数据
摘要：指纹（不可逆）`,
    pitfalls: '密码只 MD5；密钥写死在包里；忽略防重放。',
  },
})

topicDoc({
  id: 'kp-net-optimize',
  module: 'network',
  folder: '网络',
  title: '客户端网络优化',
  parts: {
    one: '少请求、快建连、少数据、弱网可恢复，并有监控。',
    structure: '合并/缓存/差量；预连接/复用/HTTPDNS/QUIC；压缩；重试退避；分片；监控分位。',
    principle: '优化要挂钩指标：成功率、耗时分位、错误码、网络类型分层。',
    usage: '上传分片并发、离线包差分、优先级队列——对齐简历项目。',
    example: '弱网：超时调优 + 退避 + 断点续传；不野蛮重试。',
    diagram: `减少请求 → 更快建连 → 更少字节 → 弱网策略 → 监控闭环`,
    pitfalls: '重试放大事故；无监控的优化是玄学。',
  },
})

// —— 协程主题（非问句，系统解剖）——
const day1 = readReview('第1天-基础与主线项目.md')
const coro = readReview('协程与并发.md')

function sliceByHeading(md, headingPart, fallback = '') {
  const idx = md.indexOf(headingPart)
  if (idx < 0) return fallback || md.slice(0, 1800)
  const rest = md.slice(idx)
  const next = rest.search(/\n### Q|\n## [^\n]+|\n# [^\n]+/)
  // 找到当前标题后的下一个同级/问答；简单取后 1800~3500 字
  return rest.slice(0, 3200)
}

topicDoc({
  id: 'kp-coroutine-basics',
  module: 'coroutine',
  folder: '协程',
  title: '协程模型：线程、挂起与续体',
  parts: {
    one: '协程是可挂起的任务，必须跑在线程上；挂起让出线程，阻塞则占着线程干等。',
    structure: `组成：
- **线程**：操作系统调度的工人
- **协程**：可暂停的工单
- **Continuation（续体）**：挂起时保存的「从哪继续」
- **挂起点**：delay / withContext / 挂起函数 / yield / await 等`,
    principle: sliceByHeading(day1, '### Q1. 协程和线程') + '\n\n' + sliceByHeading(coro, '### Q3. 挂起是什么'),
    usage: '能挂起的 IO/等待用协程；真正的阻塞 API 仍会卡住所在线程，主线程上尤其危险。',
    example: `\`\`\`kotlin
delay(1000)        // 挂起：工人可干别的
Thread.sleep(1000) // 阻塞：工人睡死
\`\`\``,
    diagram: `工人(线程) 执行 工单(协程)
工单挂起 → 夹书签(Continuation) → 工人换工单
阻塞 → 工人干等`,
    pitfalls: '把阻塞调用当成挂起；以为协程能替代线程。',
  },
})

topicDoc({
  id: 'kp-coroutine-dispatchers',
  module: 'coroutine',
  folder: '协程',
  title: 'Dispatcher 与线程池',
  parts: {
    one: 'Dispatcher 决定协程在哪类线程跑；viewModelScope 默认 Main，不是 Default。',
    structure: 'Main / Main.immediate / IO / Default / Unconfined；IO 与 Default 常共用 CoroutineScheduler。',
    principle: sliceByHeading(day1, '### Q5. 默认线程池') + '\n\n' + sliceByHeading(coro, '### Q9. Dispatcher'),
    usage: 'UI→Main；网络文件→IO；纯计算→Default；限流用 limitedParallelism 或 Semaphore。',
    example: `\`\`\`kotlin
lifecycleScope.launch { // Main
  val t = withContext(Dispatchers.IO) { readFile() }
  textView.text = t
}
\`\`\``,
    diagram: `launch 使用上下文已有 Dispatcher
无则 Default
Default≈核数；IO≥64 可扩`,
    pitfalls: '误以为所有 launch 都在 Default；Unconfined 难推理。',
  },
})

topicDoc({
  id: 'kp-coroutine-builders',
  module: 'coroutine',
  folder: '协程',
  title: 'launch、async、withContext 与结构化并发',
  parts: {
    one: 'launch 甩任务；async 取结果；withContext 同协程切换并自动回来；父子 Job 构成结构化并发。',
    structure: 'Job / Deferred；coroutineScope；supervisorScope；不要 GlobalScope。',
    principle: sliceByHeading(day1, '### Q4. `launch`') + '\n\n' + sliceByHeading(coro, '### Q10. `withContext`'),
    usage: '并行请求用 coroutineScope+async；允许部分成功用 supervisorScope。',
    example: `\`\`\`kotlin
coroutineScope {
  val a = async(Dispatchers.IO) { api.a() }
  val b = async(Dispatchers.IO) { api.b() }
  use(a.await(), b.await())
}
\`\`\``,
    diagram: `父 Scope
 ├─ child launch/async
 └─ cancel 父 → 子一起取消`,
    pitfalls: '两个 launch + 共享变量；async 异常要 await 才看到。',
  },
})

topicDoc({
  id: 'kp-coroutine-cancel',
  module: 'coroutine',
  folder: '协程',
  title: '协程取消与异常',
  parts: {
    one: '取消是协作的：标记后要到挂起点才停；CancellationException 是正常结束信号。',
    structure: 'cancel → Cancelling → 挂起点抛 CancellationException；SupervisorJob 隔离失败。',
    principle: sliceByHeading(day1, '### Q7. 取消为什么') + '\n\n' + sliceByHeading(coro, '### Q12. 取消与异常'),
    usage: 'CPU 循环加 ensureActive；catch 时先放行 CancellationException。',
    example: `\`\`\`kotlin
while (isActive) {
  work()
  ensureActive()
}
\`\`\``,
    diagram: `cancel() 只是发信号
   ↓
跑到挂起点才真正结束`,
    pitfalls: '吞掉 CancellationException；任务开在 GlobalScope。',
  },
})

topicDoc({
  id: 'kp-coroutine-flow',
  module: 'coroutine',
  folder: '协程',
  title: 'Flow 冷热流与 StateFlow/SharedFlow',
  parts: {
    one: '冷流点播；热流直播；StateFlow 做状态；一次性事件不要塞进 StateFlow。',
    structure: 'Flow / SharedFlow / StateFlow；replay；extraBufferCapacity；flowOn。',
    principle: sliceByHeading(day1, '### Q8. 冷流、热流') + '\n\n' + sliceByHeading(coro, '### Q19b. 热流'),
    usage: '页面状态 StateFlow；Toast/跳转用 Channel 或 pending 状态。',
    example: '旋转后 StateFlow 能立刻吐出当前值；Toast 放 StateFlow 会再弹。',
    diagram: `冷流：collect 才生产
StateFlow：状态（有当前值）
Effect：一次性事件`,
    pitfalls: 'replay 与缓冲搞混；flowOn 误当 withContext。',
  },
})

topicDoc({
  id: 'kp-coroutine-channel-mutex',
  module: 'coroutine',
  folder: '协程',
  title: 'Channel、Mutex 与限流',
  parts: {
    one: 'Channel 做协程间队列；Mutex 挂起互斥且默认不可重入；Semaphore/limitedParallelism 限流。',
    structure: 'Channel 容量；Mutex.withLock；Semaphore 许可。',
    principle: sliceByHeading(day1, '### Q9. `Channel`') + '\n\n' + sliceByHeading(coro, '### Q24. 协程要锁吗'),
    usage: '信令入队单消费者；下载并发 Semaphore(3)。',
    example: `\`\`\`kotlin
val gate = Semaphore(3)
gate.withPermit { download(id) }
\`\`\``,
    diagram: `生产者 send → Channel → 消费者 receive
Mutex：挂起等锁（不可重入）`,
    pitfalls: 'Mutex 锁套锁；withLock 里 delay 长时间占锁。',
  },
})

// —— 并发 / JVM / 语言：用专题 ## 节，过滤问句标题 ——
function importTopicSections(file, module, folder, titleMap = {}) {
  const sections = extractSections(readReview(file))
  for (const sec of sections) {
    const title = titleMap[sec.title] || sec.title
    if (/[？?]$/.test(title)) continue
    const id = `kp-${module}-${hash(title)}`
    topicDoc({
      id,
      module,
      folder,
      title,
      parts: {
        one: title,
        structure: '见下方详细说明中的结构与要点。',
        principle: sec.body,
        usage: '结合 Android/SDK 场景说明何时使用、如何避免坑。',
        example: sec.body.match(/```[\s\S]*?```/)?.[0] || '结合文中示例口述。',
        diagram: `${title}\n  ├─ 概念\n  ├─ 机制\n  └─ 实践`,
        pitfalls: '对照文末自测与常见追问准备 1～2 个坑。',
      },
    })
  }
}

importTopicSections('Java线程与并发.md', 'concurrent', '并发')
importTopicSections('JVM与并发原理.md', 'jvm', 'JVM')
importTopicSections('语言-Kotlin与Java.md', 'language', '语言')
importTopicSections('语言-混编详解.md', 'language', '语言', {})

// —— 架构 / Compose / 三方：主题化 ——
topicDoc({
  id: 'kp-arch-patterns',
  module: 'architecture',
  folder: '架构',
  title: 'MVC / MVP / MVVM / MVI',
  parts: {
    one: '页面内部分工方式不同：谁处理点击、状态放哪、是否单向数据流。',
    structure: readReview('基础知识/04-架构.md').slice(0, 3500),
    principle: 'MVVM 调方法+观察状态；MVI 只发 Intent，状态唯一；点击可只产生 Effect。',
    usage: '简单页 MVVM；复杂状态机用 MVI；讲取舍。',
    example: '下一页改 State；举手/复制走 Effect。',
    diagram: `MVC: Activity 易膨胀
MVP: Presenter↔View接口
MVVM: 观察 State
MVI: Intent→State→UI`,
    pitfalls: 'Toast 进 State 会再弹；样板过多。',
  },
})

topicDoc({
  id: 'kp-componentization',
  module: 'architecture',
  folder: '架构',
  title: '组件化与依赖治理',
  parts: {
    one: '模块拆分 + 依赖单向 + 路由通信；目标是并行与降发版耦合。',
    structure: 'app → 业务 → 中间件 → 基础；禁止环依赖。',
    principle: '接口下沉、实现上移；路由解耦页面；初始化任务图。',
    usage: '挂钩快传：发版频率-90%、清理无用依赖。',
    example: '跨部门冻结接口、分阶段治理。',
    diagram: `app
 ↓
feature
 ↓
middleware (IM/上传/离线包)
 ↓
foundation`,
    pitfalls: '同步 API 卡主线程；循环依赖；通信滥用 EventBus。',
  },
})

topicDoc({
  id: 'kp-router',
  module: 'architecture',
  folder: '架构',
  title: '路由原理',
  parts: {
    one: 'path → 目标页的查表跳转，可加拦截器做登录/降级。',
    structure: '编译期收集路由表；运行时 navigate；拦截器链。',
    principle: 'APT/KSP 生成表；支持参数、降级页。',
    usage: 'ARouter 常见；Navigation 偏单 Activity。',
    example: '登录拦截：未登录改去登录页。',
    diagram: `navigate(path)
  → 查表
  → 拦截器
  → 启动 Activity/Fragment`,
    pitfalls: '表过大拖启动；混淆漏 keep。',
  },
})

topicDoc({
  id: 'kp-sdk-api',
  module: 'architecture',
  folder: '架构',
  title: 'SDK 对外 API 与架构边界',
  parts: {
    one: 'SDK API 要稳定、Java 可调、线程语义清晰、不绑死宿主 DI。',
    structure: '对外 API / 内部模块（连接、收发、存储）；适配层可替换。',
    principle: '错误码优于乱抛；回调线程写进文档；keep 规则随包提供。',
    usage: '直播底座只留房间信令；RTC 适配可替换。',
    example: '换 RTC 只换适配实现，回归集中在适配层。',
    diagram: `宿主 App
  → SDK API
      → 内部模块
      → 适配层 → 第三方 SDK`,
    pitfalls: '强绑 Hilt；同步网络 API；初始化拖垮启动。',
  },
})

// Compose topics
for (const [id, title, one] of [
  ['kp-compose-vs-view', 'Compose 与 View 模型', 'Compose 声明式：状态→界面；View 命令式改控件。'],
  ['kp-compose-recomposition', '重组与状态', '读到的状态变了才重组相关函数；remember/Saveable/ViewModel 分层保存。'],
  ['kp-compose-side-effects', 'Compose 副作用 API', 'LaunchedEffect/DisposableEffect/SideEffect/rememberCoroutineScope 各管一类副作用。'],
  ['kp-compose-interop', 'Compose 与 View 混用', 'AndroidView 嵌 WebView/Cocos；ComposeView 反向嵌；注意触摸穿透。'],
]) {
  const raw = readReview('基础知识/06-Compose.md')
  topicDoc({
    id,
    module: 'compose',
    folder: 'Compose',
    title,
    parts: {
      one,
      structure: raw.slice(0, 2000),
      principle: raw,
      usage: '小学课堂：底层课件容器，上层 Compose 工具条；信令改 State。',
      example: 'collectAsStateWithLifecycle；AndroidView(factory, update)。',
      diagram: title,
      pitfalls: 'Composable 里直接 launch；Toast 进 StateFlow。',
    },
  })
}

// 三方
topicDoc({
  id: 'kp-image-loader',
  module: 'framework',
  folder: '三方框架',
  title: '图片加载框架',
  parts: {
    one: 'Glide/Coil 等负责生命周期绑定、内存/磁盘缓存、采样解码、请求合并。',
    structure: readReview('基础知识/05-常用组件框架.md').slice(0, 2200),
    principle: '三级缓存：内存 → 磁盘 → 网络；按 View 尺寸采样。',
    usage: 'Kotlin 新项目 Coil/Glide；大图场景评估 Fresco。',
    example: '自研要点：请求合并、LRU、取消、采样。',
    diagram: `Request → Memory → Disk → Network → Decode → Bind`,
    pitfalls: '大图不采样；页面销毁不取消。',
  },
})

topicDoc({
  id: 'kp-di',
  module: 'framework',
  folder: '三方框架',
  title: '依赖注入 Hilt / Koin',
  parts: {
    one: 'Hilt 编译期生成；Koin 运行时注册；SDK 不要强绑宿主 DI。',
    structure: '构造注入、单例、作用域；Hilt 基于 Dagger。',
    principle: '编译期可早失败；运行时更灵活但晚发现。',
    usage: 'App 用 Hilt 常见；SDK 对外普通工厂/init。',
    example: 'SDK.init(config) 内部自己装依赖。',
    diagram: `App DI ≠ SDK 对外 API`,
    pitfalls: 'SDK 逼宿主上 Hilt。',
  },
})

importTopicSections('市场补充-架构工具三方.md', 'framework', '三方框架')
importTopicSections('Agent与AICoding.md', 'agent', 'Agent')

// 项目主题
topicDoc({
  id: 'kp-project-live-base',
  module: 'project',
  folder: '项目',
  title: '教育直播底座架构',
  parts: {
    one: '底座只管房间与信令；业务模块插拔；RTC 可替换；切班原子入队。',
    structure: readReview('项目重点.md').split('## B.')[0],
    principle: '信令乱序用队列串行；失败回滚；SEI 同步课件。',
    usage: '复用初中/小学；指标 99%/95% 口径分开。',
    example: '伪直播 3→1 天；切班扩展 10→3 天。',
    diagram: `业务模块\n  ↓\n底座(房间+信令)\n  ↓\nRTC 适配层 → 厂商 SDK`,
    pitfalls: '课件塞进底座；SEI 丢了无补偿。',
  },
})

topicDoc({
  id: 'kp-project-im',
  module: 'project',
  folder: '项目',
  title: 'IM SDK 连接与消息可靠性',
  parts: {
    one: '连接鉴权同步后心跳保活；发送 Ack；接收去重排序；断线退避重连补拉。',
    structure: readReview('项目重点.md'),
    principle: '本地先上屏；序号补洞；toB 差异走配置扩展点。',
    usage: '融云 toB；快传 IM2.0。',
    example: '发送状态机与日志回捞脱敏。',
    diagram: `建连→鉴权→同步→心跳→收发`,
    pitfalls: '定制拖死主干；回捞无脱敏。',
  },
})

topicDoc({
  id: 'kp-project-offline-upload',
  module: 'project',
  folder: '项目',
  title: '离线包与上传 SDK',
  parts: {
    one: '离线包差分加密与校验回滚；上传分片并发与多业务调度。',
    structure: '下载状态机；分片；优先级队列；监控成功率。',
    principle: '替换中杀进程要可回滚；有界队列+失败回调。',
    usage: '99.4% 三日成功率；上传 +8%/+15%。',
    example: 'Push 预处理提前拉。',
    diagram: `差分包→校验→替换→失败回滚\n分片→并发→续传→MD5`,
    pitfalls: '口径注水；无界队列。',
  },
})

// ========== 问答：只保留提问形式 ==========
const qaSources = [
  ['协程与并发.md', 'coroutine', '协程', 'kp-coroutine-basics'],
  ['基础知识/02-Android基础.md', 'android', 'Android', 'kp-handler-system'],
  ['基础知识/03-网络.md', 'network', '网络', 'kp-tcp'],
  ['基础知识/04-架构.md', 'architecture', '架构', 'kp-arch-patterns'],
  ['基础知识/05-常用组件框架.md', 'framework', '三方框架', 'kp-image-loader'],
  ['基础知识/06-Compose.md', 'compose', 'Compose', 'kp-compose-recomposition'],
  ['基础知识/01-语言与JVM.md', 'language', '语言', 'kp-language-fallback'],
  ['第1天-基础与主线项目.md', 'coroutine', '协程', 'kp-coroutine-basics'],
]

// language fallback kp if sections thin
topicDoc({
  id: 'kp-language-fallback',
  module: 'language',
  folder: '语言',
  title: 'Java 与 Kotlin 语言基础总览',
  parts: {
    one: 'Java OOP/集合/异常/注解；Kotlin 空安全、sealed、扩展、协程互操作。',
    structure: readReview('语言-Kotlin与Java.md').slice(0, 3000),
    principle: readReview('语言-Kotlin与Java.md'),
    usage: 'SDK 对外顾及 Java 调用；suspend 不能直接给 Java。',
    example: '平台类型；@JvmStatic/@JvmOverloads/@Throws。',
    diagram: 'Java 底子 + Kotlin 语法糖 + 混编注解',
    pitfalls: '!!；忽略平台类型空指针。',
  },
})

const refMap = [
  [/Handler|Looper|Message|同步屏障|IdleHandler|HandlerThread/i, 'kp-handler-system'],
  [/启动模式|生命周期|onNewIntent|配置变更|进程/i, 'kp-activity-lifecycle'],
  [/触摸|分发|滑动冲突|onIntercept/i, 'kp-touch-dispatch'],
  [/Service|前台服务|保活|WorkManager/i, 'kp-service-bg'],
  [/ANR/i, 'kp-anr'],
  [/UDP/i, 'kp-udp'],
  [/TCP|握手|挥手/i, 'kp-tcp'],
  [/HTTPS|证书|TLS|Pinning/i, 'kp-https-cert'],
  [/QUIC|HTTP\/3|HTTP\/2/i, 'kp-quic'],
  [/长连接|心跳|重连|Ack|粘包|WebSocket|Socket/i, 'kp-long-connection'],
  [/OkHttp|拦截器/i, 'kp-okhttp'],
  [/DNS|CDN|HTTPDNS/i, 'kp-dns-cdn'],
  [/加密|对称|非对称|摘要|MD5|AES/i, 'kp-crypto-basic'],
  [/弱网|网络优化/i, 'kp-net-optimize'],
  [/StateFlow|SharedFlow|冷流|热流|Flow|replay/i, 'kp-coroutine-flow'],
  [/Channel|Mutex|Semaphore|限流/i, 'kp-coroutine-channel-mutex'],
  [/cancel|取消|Supervisor|异常/i, 'kp-coroutine-cancel'],
  [/launch|async|withContext|Scope|Job/i, 'kp-coroutine-builders'],
  [/Dispatcher|线程池|Default|Dispatchers/i, 'kp-coroutine-dispatchers'],
  [/协程|挂起|阻塞|续体/i, 'kp-coroutine-basics'],
  [/MVI|MVVM|MVP|MVC|Intent|Effect/i, 'kp-arch-patterns'],
  [/组件化|模块化|依赖/i, 'kp-componentization'],
  [/路由|ARouter|Navigation/i, 'kp-router'],
  [/SDK|API 稳定|适配层/i, 'kp-sdk-api'],
  [/Compose|重组|remember|AndroidView|LaunchedEffect/i, 'kp-compose-recomposition'],
  [/Glide|Coil|图片|Bitmap/i, 'kp-image-loader'],
  [/Hilt|Koin|Dagger|注入|DI/i, 'kp-di'],
  [/切班|底座|SEI|RTC|直播/i, 'kp-project-live-base'],
  [/IM|融云|消息可靠|长连接/i, 'kp-project-im'],
  [/离线|上传|分片/i, 'kp-project-offline-upload'],
]

function mapRef(title, fallback) {
  for (const [re, id] of refMap) if (re.test(title)) return id
  return fallback
}

const seenQ = new Map()
let qaCount = 0

for (const [file, module, folder, fallback] of qaSources) {
  const qas = extractQAs(readReview(file))
  for (const q of qas) {
    let mod = module
    let fold = folder
    if (file.includes('第1天')) {
      if (/Handler|启动|生命周期|ANR|事件|Service/.test(q.title)) {
        mod = 'android'
        fold = 'Android'
      } else if (/synchronized|线程池|HashMap|死锁|volatile|sleep|wait|ConcurrentHashMap/.test(q.title)) {
        mod = 'concurrent'
        fold = '并发'
      } else if (/空安全|sealed|扩展|suspend|Java|data class|enum/.test(q.title)) {
        mod = 'language'
        fold = '语言'
      }
    }
    const key = q.title.replace(/\s/g, '')
    const prev = seenQ.get(key)
    if (prev && prev >= q.answer.length) continue
    const id = `q-${hash(key)}`
    const knowledge_ref = mapRef(q.title, fallback)
    const priority = file.includes('第1天') ? 'P0' : q.priority
    write(
      `${fold}/${id}.md`,
      `---
id: ${id}
type: qa
module: ${mod}
knowledge_ref: ${knowledge_ref}
title: ${q.title.replace(/"/g, "'").slice(0, 40)}
priority: ${priority}
version: 1
---

## 问题
${q.title}

## 答案
${q.answer}
`,
    )
    if (!prev) qaCount++
    seenQ.set(key, q.answer.length)
  }
}

// 项目表格式追问 → 问答
{
  const md = readReview('项目重点.md')
  for (const row of md.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm)) {
    const q = row[1].trim()
    const a = row[2].trim()
    if (q.length < 4 || a.length < 4) continue
    if (/问题|重点条目|—|---/.test(q)) continue
    const id = `q-${hash('proj' + q)}`
    write(
      `项目/${id}.md`,
      `---
id: ${id}
type: qa
module: project
knowledge_ref: ${mapRef(q, 'kp-project-live-base')}
title: ${q.replace(/"/g, "'").slice(0, 40)}
priority: P0
version: 1
---

## 问题
${q}

## 答案
${a}
`,
    )
    qaCount++
  }
}

// 算法
{
  const md = readReview('基础算法.md')
  for (const row of md.matchAll(/^\|\s*(必刷|次刷)\s*\|\s*\*\*?(\d+)\*\*?\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|$/gm)) {
    const [, level, no, title, tip] = row
    write(
      `算法/lc-${no}.md`,
      `---
id: algo-${no}
type: algo
module: algo
title: ${title.trim().replace(/"/g, "'")}
leetcode: ${no}
priority: ${level === '必刷' ? 'P0' : 'P1'}
version: 1
tags: ["算法"]
---

## 题目
力扣 ${no}：${title.trim()}

考点：${tip.trim() || '见题解'}

## 答案
思路：${tip.trim() || '先识别题型再套模板。'}

步骤：识别题型 → 写模板 → 补边界 → 口述复杂度。
`,
    )
  }
}

// glossary.yaml 独立维护（含 IPA + speak），重建知识点时不要覆盖

console.log('topic knowledge rebuilt; qa≈', qaCount)
console.log('run: npm run content')
