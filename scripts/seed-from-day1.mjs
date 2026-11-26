/**
 * One-shot seeder: import Day1 review material into review-content/
 * Run: node scripts/seed-from-day1.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = path.join(root, 'review-content')

function write(rel, text) {
  const p = path.join(base, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text.trimStart())
  console.log('write', rel)
}

function kp(id, module, title, priority, version, body) {
  return `---
id: ${id}
type: knowledge
module: ${module}
title: ${title}
priority: ${priority}
version: ${version}
---

${body.trim()}
`
}

function qa(id, module, knowledge_ref, priority, version, question, answer) {
  return `---
id: ${id}
type: qa
module: ${module}
${knowledge_ref ? `knowledge_ref: ${knowledge_ref}\n` : ''}title: ${question.slice(0, 24)}
priority: ${priority}
version: ${version}
---

## 问题
${question.trim()}

## 答案
${answer.trim()}
`
}

function algo(id, title, leetcode, tags, priority, version, problem, answer) {
  return `---
id: ${id}
type: algo
module: algo
title: ${title}
leetcode: ${leetcode}
priority: ${priority}
version: ${version}
tags: [${tags.map((t) => `"${t}"`).join(', ')}]
---

## 题目
${problem.trim()}

## 答案
${answer.trim()}
`
}

write(
  'modules.yaml',
  `
- id: project
  name: 项目口述
  order: 0
- id: coroutine
  name: 协程
  order: 1
- id: concurrent
  name: 并发
  order: 2
- id: android
  name: Android
  order: 3
- id: language
  name: 语言
  order: 4
- id: algo
  name: 算法
  order: 90
`,
)

// —— 项目 ——
write(
  '项目/kp-intro.md',
  kp(
    'kp-intro',
    'project',
    '自我介绍 90 秒',
    'P0',
    1,
    `
## 一句话

12 年 Android，近 10 年 SDK/中台；融云 IM、快传治理、直播底座、排查 Agent。

## 为什么 / 卡点

自我介绍超时、数字口径说不清、攻击前公司。只留 3 个数字，被问再展开。

## 例子

口述稿：融云做连接收发（上千家 toB）→ 快传跨 5 部门降核心库发版频率 → 与爱为舞底座只管房间信令、RTC 可换、小学 Compose+H5/Cocos → Agent 拉日志对源码给初判。

数字：进房切班约 99%；发版频率 -90%；排查耗时降 90%+。

## 画面

\`\`\`text
融云 IM  →  快传中台/离线包/上传  →  直播底座 + Agent
\`\`\`
`,
  ),
)

write(
  '项目/kp-live-base.md',
  kp(
    'kp-live-base',
    'project',
    '直播底座与切班',
    'P0',
    1,
    `
## 一句话

底座只留房间和信令；课件白板上下台插拔；RTC 适配可替换；切班原子入队。

## 为什么 / 卡点

课件写进底座就无法复用初中/小学。多服务信令乱序，必须队列串行，失败回滚。

## 例子

1. 业务只调进房/推拉流/回调，换火山或腾讯只换适配实现。  
2. 切班：用户不停课，只换班级资源；超时重试有上限，失败滚回切班前并打点。  
3. 伪直播 3 天→1 天，切班扩展 10 天→3 天，靠复用。99% 与小学含动态下载 95% 口径不同。

## 画面

\`\`\`text
业务模块（课件/白板/上下台）
        ↓
底座：房间生命周期 + 信令通道
        ↓
RTC 适配层 → 具体 RTC SDK

切班：入队 → 原子执行 → 成功 / 失败回滚
\`\`\`
`,
  ),
)

write(
  '项目/kp-rongcloud-im.md',
  kp(
    'kp-rongcloud-im',
    'project',
    '融云长连接与可靠性',
    'P0',
    1,
    `
## 一句话

建连鉴权同步 → 心跳 → 发 Ack / 收去重排序入库；断网退避重连后补拉。

## 为什么 / 卡点

界面等 Ack 才上屏，弱网像卡死。定制客户不能拖死主干。

## 例子

发送：本地插入 → 发送中 → Ack 成功，或失败进重试队列。  
接收：会话序号去重、排序、入库、上屏。  
断网：网络回调 + 退避重连 + 序号补洞。  
日志回捞：开关、脱敏、体积上限。

## 画面

\`\`\`text
DNS/接入 → 建连 → 鉴权 → 同步离线
              ↓
         心跳保活
              ↓
发：本地上屏 → 等 Ack → 失败重试
收：去重排序 → 入库 → 上屏
\`\`\`
`,
  ),
)

write(
  '项目/q-intro.md',
  qa('q-intro', 'project', 'kp-intro', 'P0', 1, '请做 90 秒自我介绍。', '12 年 Android，近 10 年 SDK/中台。融云 IM 连接收发；快传跨部门治理与离线包/上传；直播底座只管房间信令、RTC 可换；排查 Agent 拉日志对源码。数字：进房切班约 99%，发版 -90%，排查耗时降 90%+。'),
)
write(
  '项目/q-live-boundary.md',
  qa('q-live-boundary', 'project', 'kp-live-base', 'P0', 1, '为什么直播底座不包含课件？切班怎么做？', '课件变更多、产品差异大，放进底座无法复用。底座只留房间和信令，模块插拔。切班是原子动作，信令入队串行，失败回滚。RTC 经适配层可替换。'),
)
write(
  '项目/q-im-connect.md',
  qa('q-im-connect', 'project', 'kp-rongcloud-im', 'P0', 1, '从连接到消息出现走一遍；断网怎么办？', '建连→鉴权→同步→心跳。发送本地先上屏再等 Ack；接收按序号去重排序入库。断网：退避重连后补拉。'),
)

// —— 协程：补知识点与问答 ——
write(
  '协程/kp-suspend.md',
  kp(
    'kp-suspend',
    'coroutine',
    '挂起不是阻塞',
    'P0',
    2,
    `
## 一句话

协程挂起让出线程；\`Thread.sleep\` 把工人睡死。挂起救不了主线程上的阻塞 IO。

## 为什么 / 卡点

以为协程等于轻量线程，在主线程调阻塞读文件，照样卡。

## 例子

\`\`\`kotlin
delay(1000)          // 工单暂停，工人可干别的
Thread.sleep(1000)   // 工人睡死
\`\`\`

## 画面

\`\`\`text
工单 → 挂起点夹书签(Continuation) → 工人干别的 → 按 Dispatcher 恢复
\`\`\`
`,
  ),
)

write(
  '协程/kp-dispatcher.md',
  kp(
    'kp-dispatcher',
    'coroutine',
    'Dispatcher 与默认池',
    'P0',
    2,
    `
## 一句话

恢复认 Dispatcher。\`viewModelScope.launch\` 默认 Main，不是 Default。Default 与 IO 共用 CoroutineScheduler。

## 为什么 / 卡点

面试常绕：「默认线程池是 Default」——要先问 Scope 自带什么。

## 例子

\`\`\`kotlin
lifecycleScope.launch {
  val t = withContext(Dispatchers.IO) { readFile() }
  textView.text = t // 回 Main
}
\`\`\`

Default≈核数给计算；IO≥64 可扩给阻塞；Main 是主线程；\`limitedParallelism(4)\` 是限并发不是新建 4 线程池。

## 画面

\`\`\`text
launch 用上下文已有 Dispatcher
无则 Default
Default/IO 同池不同并行度规则
\`\`\`
`,
  ),
)

write(
  '协程/kp-coop-schedule.md',
  kp(
    'kp-coop-schedule',
    'coroutine',
    '同线程协作调度',
    'P0',
    1,
    `
## 一句话

同线程多协程只在挂起点交替；无挂起死循环会饿死同线程其它任务。

## 为什么 / 卡点

以为会像线程时间片轮转。方法不会执行一会儿就自动让出。

## 例子

\`\`\`kotlin
launch { println("1-A"); delay(100); println("1-B") }
launch { println("2-A"); delay(100); println("2-B") }
// 常见：1-A → 2-A → …
\`\`\`

循环里加 \`yield()\`/\`ensureActive()\`。Default 上死循环占满工人会饿死其它计算。

## 画面

\`\`\`text
同一工人：工单1跑到挂起 → 工单2 → 再回来
无挂起：工单2一直排不上
\`\`\`
`,
  ),
)

write(
  '协程/kp-scope-cancel.md',
  kp(
    'kp-scope-cancel',
    'coroutine',
    'Scope 与取消协作',
    'P0',
    1,
    `
## 一句话

Scope 是工单主人；\`cancel\` 要到挂起点才生效；\`CancellationException\` 不要当业务异常吃掉。

## 为什么 / 卡点

\`viewModelScope\` 清了协程还在跑：往往没挂起点、吞了取消、或开在 GlobalScope。

## 例子

| Scope | 取消时机 | 用途 |
|--|--|--|
| lifecycleScope | 界面销毁（含旋转） | 仅跟本次界面 |
| viewModelScope | onCleared | 页面数据请求 |
| rememberCoroutineScope | 离开组合 | 点击里开协程 |

上传离开页面也要完成：SDK Scope 或 WorkManager，别挂 viewModelScope。

\`SupervisorJob\`：一子失败不取消兄弟。

## 画面

\`\`\`text
cancel → Job 取消中 → 跑到挂起点抛 CancellationException → 结束
\`\`\`
`,
  ),
)

write(
  '协程/kp-flow.md',
  kp(
    'kp-flow',
    'coroutine',
    '冷热流与 StateFlow',
    'P0',
    1,
    `
## 一句话

冷流有人收集才跑；StateFlow 有当前值适合页面状态；Toast 不要进 StateFlow。

## 为什么 / 卡点

Toast 放 StateFlow，旋转后再弹。\`replay\` 与 \`extraBufferCapacity\` 不是一回事。

## 例子

StateFlow：必有初值；新订阅立刻拿当前值；equals 相同不通知。  
SharedFlow replay=0：当时没人 collect 就丢。  
一次性事件：Channel/SharedFlow(replay=0)，或 pending 状态用完清掉。  
\`flowOn\` 只切上游生产线程。

## 画面

\`\`\`text
冷流=点播（每人重跑）
热流=直播
StateFlow → UI 状态
Effect → Toast/跳转（一次性）
\`\`\`
`,
  ),
)

write(
  '协程/kp-channel-mutex.md',
  kp(
    'kp-channel-mutex',
    'coroutine',
    'Channel 与 Mutex',
    'P0',
    1,
    `
## 一句话

Channel 是协程队列；Mutex 挂起等锁且不可重入；限流用 Semaphore。

## 为什么 / 卡点

Mutex 锁套锁会自己等自己；withLock 里 delay 不放锁。

## 例子

信令入队：多生产者 send，单消费者 for。  
\`Semaphore(3).withPermit { download() }\`。

## 画面

\`\`\`text
synchronized 阻塞线程可重入
Mutex     挂起协程不可重入
\`\`\`
`,
  ),
)

const coroutineQas = [
  ['q-suspend-vs-block', 'kp-suspend', '协程挂起和线程阻塞有什么区别？', '挂起让出线程干别的协程；阻塞占着线程干等。Dispatchers 背后仍是线程。主线程阻塞 IO，协程也救不了。'],
  ['q-resume-thread', 'kp-dispatcher', '挂起恢复后还在原来那条线程吗？', '不保证。认 Dispatcher。IO 可能换线程；Main 回主线程。withContext(IO) 结束后回到调用前 Dispatcher。'],
  ['q-coop-loop', 'kp-coop-schedule', '同线程两个协程会交叉吗？死循环呢？', '只在挂起点交替。无挂起死循环会饿死同线程其它协程。要 yield/ensureActive。'],
  ['q-launch-async', 'kp-dispatcher', 'launch、async、withContext 怎么选？', 'launch 无返回值；async 要 await 结果；并行请求用 coroutineScope+async；withContext 同协程临时换线程并自动回来。不用 GlobalScope。'],
  ['q-default-pool', 'kp-dispatcher', '协程默认线程池是什么？', 'launch 用上下文已有 Dispatcher；viewModelScope 默认 Main。无则 Default。Default/IO 同池：Default≈核数，IO≥64。'],
  ['q-scope', 'kp-scope-cancel', 'lifecycleScope 和 viewModelScope 怎么选？', '跟界面用 lifecycleScope（旋转会取消）；跟页面数据用 viewModelScope。离开还要做完的用 SDK Scope/WorkManager。'],
  ['q-cancel-coop', 'kp-scope-cancel', '为什么 cancel 了有时还在跑？', '取消协作：要到挂起点。死循环无 ensureActive；catch 吞掉 CancellationException；任务不在该 Scope 下。'],
  ['q-stateflow-toast', 'kp-flow', 'StateFlow 和 SharedFlow 的 replay？Toast 放哪？', 'StateFlow 有当前值做状态。replay 给新收集者补历史；extraBufferCapacity 是在途缓冲。Toast 放 StateFlow 会再弹，用一次性通道或 pending 清掉。'],
  ['q-mutex', 'kp-channel-mutex', 'Mutex 和 synchronized 差别？怎么限流？', 'Mutex 挂起不阻塞线程，不可重入。限流 Semaphore 或 limitedParallelism。'],
]

for (const [id, ref, q, a] of coroutineQas) {
  write(`协程/${id}.md`, qa(id, 'coroutine', ref, 'P0', 1, q, a))
}

// —— 并发 ——
write(
  '并发/kp-jmm-locks.md',
  kp(
    'kp-jmm-locks',
    'concurrent',
    '锁、volatile、原子性',
    'P0',
    1,
    `
## 一句话

原子性靠锁/原子类；可见性/有序靠 volatile 或锁；volatile 不做 i++。

## 为什么 / 卡点

双重检查单例实例字段必须 volatile，否则可能看见未构造完的对象。

## 例子

synchronized 可重入、默认非公平。ReentrantLock 可 tryLock、公平锁要传 true。  
i++ 用 AtomicInteger。

## 画面

\`\`\`text
原子性 | 可见性 | 有序性
锁/原子类 | volatile/锁 | volatile/锁
\`\`\`
`,
  ),
)

write(
  '并发/kp-thread-pool.md',
  kp(
    'kp-thread-pool',
    'concurrent',
    '线程池与无界队列',
    'P0',
    1,
    `
## 一句话

任务顺序：核心线程 → 队列 → 最大线程 → 拒绝。无界队列让最大线程数失效。

## 为什么 / 卡点

以为核心满了就扩到最大。其实先入队。

## 例子

Abort 抛异常；CallerRuns 调用者跑（主线程提交可能 ANR）；Discard 默默丢。SDK 用有界队列+失败回调。

## 画面

\`\`\`text
新任务 → <core 新建 → 入队 → <max 新建 → 拒绝
无界队列：永远走不到扩 max
\`\`\`
`,
  ),
)

write(
  '并发/kp-deadlock-hashmap.md',
  kp(
    'kp-deadlock-hashmap',
    'concurrent',
    '死锁与 HashMap',
    'P0',
    1,
    `
## 一句话

死锁四条件；Mutex 同协程锁两次也会卡。HashMap 非线程安全；CHM 只保证单次操作原子。

## 为什么 / 卡点

先 get 再 put 不是原子。sleep 不放锁，wait 放锁。

## 例子

A 锁1等2，B 锁2等1。规定加锁顺序。  
delay 不是 sleep 也不是 wait。

## 画面

\`\`\`text
互斥 + 占有且等待 + 不剥夺 + 循环等待 = 死锁
\`\`\`
`,
  ),
)

const concurrentQas = [
  ['q-volatile', 'kp-jmm-locks', 'synchronized、volatile、ReentrantLock 区别？i++ 为什么不安全？', 'synchronized/ReentrantLock 互斥；volatile 可见与有序，不做 i++。DCL 单例要 volatile。ReentrantLock(true) 才公平。'],
  ['q-pool', 'kp-thread-pool', '线程池参数和无界队列坑？', '先核心再队列再扩到最大。无界队列使 max 失效，任务堆内存。SDK 用有界队列。'],
  ['q-sleep-wait', 'kp-deadlock-hashmap', 'sleep 和 wait 区别？死锁条件？', 'sleep 不放锁；wait 在同步块里放锁。死锁四条件。Mutex 不可重入会自己锁死。'],
  ['q-hashmap', 'kp-deadlock-hashmap', 'HashMap 为何不安全？CHM 安全到哪？', '并发 put/扩容丢数据。CHM 单次操作原子，先查再插要用 putIfAbsent/compute。'],
]

for (const [id, ref, q, a] of concurrentQas) {
  write(`并发/${id}.md`, qa(id, 'concurrent', ref, 'P0', 1, q, a))
}

// —— Android ——
write(
  'Android/kp-handler.md',
  kp(
    'kp-handler',
    'android',
    'Handler 循环与泄漏',
    'P0',
    2,
    `
## 一句话

Looper 从 MessageQueue 取消息交给 Handler；内部类 Handler + 未执行消息会泄漏 Activity。

## 为什么 / 卡点

只弱引用不够，还要 onDestroy 清消息。

## 例子

\`removeCallbacksAndMessages(null)\`。同步屏障让绘制消息插队，业务别自己插。

## 画面

\`\`\`text
Queue → Message → Handler → 内部类 → Activity
\`\`\`
`,
  ),
)

write(
  'Android/kp-lifecycle.md',
  kp(
    'kp-lifecycle',
    'android',
    '启动模式与生命周期',
    'P0',
    1,
    `
## 一句话

四种 launchMode；旋转重建 ViewModel 还在；进程被杀只靠 Bundle 小状态。

## 为什么 / 卡点

remember 防重组不防旋转。singleTask 会清掉上面页面。

## 例子

寿命：局部变量 < remember < ViewModel < rememberSaveable/SavedStateHandle。

## 画面

\`\`\`text
旋转：Activity 毁，ViewModel 留
杀进程：ViewModel 没，Bundle 小状态，长连接重连
\`\`\`
`,
  ),
)

write(
  'Android/kp-anr.md',
  kp(
    'kp-anr',
    'android',
    'ANR 怎么查',
    'P0',
    1,
    `
## 一句话

主线程长时间没处理完该做的事。看 traces 主线程栈：重活、等锁、卡 Binder。

## 为什么 / 卡点

SDK 同步 API 碰网络，调用方主线程一调就是他们的 ANR。

## 例子

输入约 5 秒；前台广播约 10 秒；前台 Service 约 20 秒（约数）。主线程只调度。

## 画面

\`\`\`text
栈在业务函数=重活
monitor contention=等锁
Binder transact=等别的进程
\`\`\`
`,
  ),
)

write(
  'Android/q-handler-leak.md',
  qa('q-handler-leak', 'android', 'kp-handler', 'P0', 1, 'Handler 为什么泄漏？怎么防？', 'Message→Handler→内部类 Activity。静态类+弱引用，并 removeCallbacksAndMessages。'),
)
write(
  'Android/q-launch-mode.md',
  qa('q-launch-mode', 'android', 'kp-lifecycle', 'P0', 1, '四种启动模式？onNewIntent 何时来？', 'standard 每次 new；singleTop 栈顶复用；singleTask 清上面再复用；singleInstance 独占栈。复用走 onNewIntent 并 setIntent。'),
)
write(
  'Android/q-rotate-kill.md',
  qa('q-rotate-kill', 'android', 'kp-lifecycle', 'P0', 1, '旋转和进程被杀有何不同？', '旋转 ViewModel 还在；进程被杀 ViewModel 没了，只靠 SavedState 小数据，长连接重连。'),
)
write(
  'Android/q-anr.md',
  qa('q-anr', 'android', 'kp-anr', 'P0', 1, 'ANR 怎么查？', '看主线程栈：自己重活、等锁、卡 Binder。主线程别做网络磁盘解码。'),
)

// —— 语言 ——
write(
  '语言/kp-kotlin-basics.md',
  kp(
    'kp-kotlin-basics',
    'language',
    '空安全、sealed、扩展、suspend',
    'P0',
    1,
    `
## 一句话

平台类型可能是 null；sealed 做状态；扩展是静态方法；suspend 不能直接给 Java。

## 为什么 / 卡点

\`!!\` 把编译错误变崩溃。enum 结构必须相同，sealed 子类结构可不同。

## 例子

给 Java：回调包一层。\`@JvmStatic\` \`@JvmOverloads\` \`@Throws\`。

## 画面

\`\`\`text
data=equals/copy
sealed=when 穷尽状态机
enum=同结构常量
\`\`\`
`,
  ),
)

write(
  '语言/q-platform-type.md',
  qa('q-platform-type', 'language', 'kp-kotlin-basics', 'P0', 1, 'Kotlin 调 Java 要注意什么？', '无注解时是平台类型，运行时可能 null。公共 API 标空注解。'),
)
write(
  '语言/q-sealed-enum.md',
  qa('q-sealed-enum', 'language', 'kp-kotlin-basics', 'P0', 1, 'sealed 和 enum 区别？', 'enum 每项同结构；sealed 子类可不同字段，适合 State/Intent，when 可穷尽。'),
)
write(
  '语言/q-suspend-java.md',
  qa('q-suspend-java', 'language', 'kp-kotlin-basics', 'P0', 1, '为什么 Java 不能直接调 suspend？', '编译多 Continuation 参数，Java 对不上。对外用回调，内部协程。'),
)

// —— 算法 day1 ——
const algos = [
  ['algo-206', '反转链表', '206', ['链表'], '三指针 prev/cur/next：先存 next，再 cur.next=prev，前进。', '易断链；空链表与单节点成立。'],
  ['algo-141', '环形链表', '141', ['链表'], '快慢指针，快两步，相遇有环。', '先判 fast 与 fast.next 非空。'],
  ['algo-21', '合并两有序链表', '21', ['链表'], '哑节点，谁小接谁，一条完接另一条。', '返回 dummy.next。'],
  ['algo-19', '删倒数第 N 个', '19', ['链表'], '快先走 n，再一起走，慢在待删前。', '删头用哑节点。'],
  ['algo-20', '有效括号', '20', ['栈'], '左入栈，右对栈顶，结束栈空。', '交叉括号会失败。'],
  ['algo-155', '最小栈', '155', ['栈'], '值栈+最小值栈同步出入。', '取 min 看辅助栈顶 O(1)。'],
]

for (const [id, title, lc, tags, problem, answer] of algos) {
  write(`算法/${id.replace('algo-', 'lc-')}.md`, algo(id, title, lc, tags, 'P0', 1, problem, answer))
}

// expand glossary
write(
  'glossary.yaml',
  `
- word: Dispatcher
  phonetic: /dɪˈspætʃə/
  meaning: 协程调度器，规定协程在哪类线程上跑（Main / IO / Default）。
- word: Continuation
  phonetic: /kənˌtɪnjuˈeɪʃn/
  meaning: 续体。挂起时保存的执行位置与局部变量。
- word: StateFlow
  phonetic: —
  meaning: 有当前值的热流，适合页面状态；相同值不重复通知。
- word: SharedFlow
  phonetic: —
  meaning: 可配置 replay 的热流；replay=0 时无人收集会丢。
- word: Mutex
  phonetic: /ˈmjuːteks/
  meaning: 协程互斥锁，挂起等待，默认不可重入。
- word: Semaphore
  phonetic: /ˈseməfɔː/
  meaning: 信号量，限制同时执行数量。
- word: Handler
  phonetic: /ˈhændlə/
  meaning: 把消息投到绑定 Looper 的线程执行。
- word: Looper
  phonetic: /ˈluːpə/
  meaning: 线程消息循环，从 MessageQueue 取消息。
- word: ANR
  phonetic: —
  meaning: 主线程长时间未处理完输入或超时任务。
- word: volatile
  phonetic: /ˈvɒlətaɪl/
  meaning: 保证可见性与一定有序，不保证 i++ 原子性。
- word: ReentrantLock
  phonetic: —
  meaning: 可重入锁，支持 tryLock、公平锁、多 Condition。
- word: CoroutineScope
  phonetic: —
  meaning: 协程生命周期容器；取消会传递给子协程。
- word: SEI
  phonetic: —
  meaning: 补充增强信息，常在 RTC 中携带时间线，用来同步课件。
- word: RTC
  phonetic: —
  meaning: 实时音视频通信。底座经适配层对接具体厂商 SDK。
`,
)

console.log('seed done')
