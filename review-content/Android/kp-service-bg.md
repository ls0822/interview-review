---
id: kp-service-bg
type: knowledge
module: android
title: Service 与后台限制
priority: P0
version: 2
---

## 一句话

Service 有两种活法：`start` 之后自己跑，直到 `stop`；`bind` 之后把 Binder 交给调用方，没人绑且没 start 过就可以销毁。Android 8 以后，应用在后台不能随意 `startService`。用户能感知的持续工作才用前台服务，并且要通知和类型。IM 保活不讲拉起和双进程互拉。

## 组成与结构

| 方式 | 生命周期由谁决定 | 关键回调 | 结束 |
|------|------------------|----------|------|
| `startService` / `startForegroundService` | 服务自己，和调用方页面无关 | `onStartCommand` 可多次 | `stopSelf` 或 `stopService` |
| `bindService` | 绑定关系 | `onBind` 返回 Binder，供调用方调方法 | `unbindService`；若没有 start 过，可以销毁 |
| 两者同时 | start 保住进程内的服务，bind 提供接口 | 都会走到 | 既要 stop 也要全部解绑，才会销毁 |

前台服务额外要求：先有一条用户看得见的通知，再 `startForeground`。高版本在清单里声明 `foregroundServiceType`，类型要和真实工作一致，例如媒体播放、数据同步、连接设备。类型和实际行为对不上，会被系统限制或审核拒绝。

`IntentService` 的想法是后台串行队列，类已过时。新代码用协程、HandlerThread 或 WorkManager。要活过进程死亡、可以等待网络的任务用 WorkManager，最小周期约 15 分钟，不要用 `GlobalScope` 假装能活到传完。

广播和 Provider 常被一起问到，但不是 Service：广播是系统或应用事件，高版本隐式广播和后台限制很多，应用内事件用本地总线或 Flow。ContentProvider 用于跨应用共享数据和权限，也常被拿来做初始化入口，启动时堆太多 init 会拖冷启动。官方更建议用 App Startup 编排初始化。

## 原理（深度，分步骤，讲清为什么）

**1. 为什么 start 和 bind 要分成两套**

start 表达的是「请做一件不依赖我这个页面的事」。调用方 Activity 销毁了，服务还可以继续，所以必须有人明确 `stop`，否则会一直占着。bind 表达的是「我要一个可调用的对象」。绑定关系没了，如果没有别的 start 在撑着，服务就没有存在的理由，系统可以销毁它。

两者可以同时用：start 负责把连接或下载保住，bind 负责把接口给界面。只 bind 不 start 时，界面一解绑服务就没了，不适合「退到后台还要收消息」这种需求；而退到后台还要持续工作，又受到后台限制，不能靠普通 start 硬扛。

**2. `onStartCommand` 为什么可能多次进来**

每次 `startService` 都会再走一次 `onStartCommand`，而不是只在创建时走一次。服务第一次创建才有 `onCreate`。多次开始要在 `onStartCommand` 里用 startId 区分。`stopSelf()` 不带 id 会把整个服务停掉，可能把后一次 start 的工作一起停了。`stopSelf(startId)` 只在这是最后一次 start 时才停。返回值 `START_STICKY`、`START_NOT_STICKY`、`START_REDELIVER_INTENT` 决定进程被杀后系统要不要再把服务拉起来、要不要重投 Intent。面试说明「返回值是在说被杀之后怎么办」即可，不要把它们说成保活手段。

**3. 后台限制在限制什么**

Android 8 之后，应用不在前台时，后台直接 `startService` 会抛 `IllegalStateException`。原因是后台服务用户看不见，却在耗电和占进程。允许的路是：前台时启动；或使用 `startForegroundService`，并在很短时间内（约数秒）调用 `startForeground` 把通知挂上。超时不挂通知，系统会把应用判 ANR 或停掉服务。

前台服务不是「加个通知就能随便活」。类型必须声明，并且和真实行为一致。用户能感知的持续工作，例如正在播放、正在通话、正在同步一块用户刚点过的数据，才适合。用来偷偷保住 IM 进程，通知会一直挂着，审核和系统都会越来越严。连接断了，正确的说法是：能建连就建，断了按退避重连；需要用户感知的通话态才上前台服务。不要讲双进程互拉、静音音乐、漏洞拉起。

**4. bind 的 Binder 在进程内和跨进程不一样**

同一进程可以返回一个普通 Binder 子类，调用方直接拿方法。跨进程必须是 AIDL 或 Messenger 这类可序列化的接口，参数要能写进 Parcel。不要在 Binder 方法里做耗时操作：调用方如果在主线程调用，卡的是对方主线程。SDK 把同步网络放进 Binder 或普通同步 API，等于把 ANR 交给宿主。

**5. 为什么 IntentService 被换掉**

它内部是 HandlerThread 加一个队列，处理完自己停。行为可以用协程队列或 WorkManager 表达得更清楚，而且它默认仍受后台启动限制。新项目不要再以它为中心设计。

`onStartCommand` 的返回值是在回答「进程被系统杀掉之后，要不要把这次启动再送回来」。`START_NOT_STICKY` 表示不要自动再拉，适合用户已经离开、任务可以下次再说的同步。`START_REDELIVER_INTENT` 会把最后一次 Intent 再送进来，适合可以接着做的下载，但仍然不是保活：系统可以很久以后才送，而且后台限制还在。选择返回值时先说产品能不能接受丢失这一次，再说要不要重投。

绑定计数也要自己想清楚。两个界面都 bind 了同一个服务，只有都解绑且没有 start 过，服务才会销毁。一个界面在 `onStop` 解绑，另一个还停在前台，服务应继续。如果在第一个界面解绑时就 `stopSelf`，第二个界面的 Binder 调用会失败。start 和 bind 的结束条件写在一处，不要散落在各个 Activity 里各自 stop。

前台服务的通知要在服务刚起来时就挂上，网络放在 startForeground 之后。类型和清单一致，并且和用户能感知的工作一致。IM 断线讲退避重连，不讲双进程互拉。

多次 start 都有自己的 startId。无参 stopSelf 会把后一次任务一起停掉，连续启动时用带 id 的 stopSelf。

只 bind 不 start 时，界面一解绑服务就可以销毁。

## 使用与实践

- 短任务、可失败重试、要约束网络：WorkManager。上传在页面退出后仍要完成，用任务队列或 WorkManager，不要挂在 `viewModelScope` 上，页面销毁协程会被取消。
- 用户正在看的播放、通话：前台服务，通知渠道先建好，类型写进清单，进入前台状态后立刻 `startForeground`。
- 给界面一个可调用对象、随页面走：bind。解绑放在和绑定对称的生命周期里，避免泄漏 ServiceConnection。
- IM：讲连接状态机、心跳、退避重连、消息补拉。被问保活时，把话题收回到「前台服务的合规条件」和「断线后的重连」，不展开流氓手段。
- 初始化不要堆在 ContentProvider 的 `onCreate` 里。那条路径在启动早期，容易拖首屏，也容易在主线程做网络。启动任务用依赖图，能延后的放到首帧之后。

## 例子（至少 1 个完整代码或伪代码块 + 边界场景）

用户点了「开始同步」且同步过程需要通知时，用前台服务。开始后立刻挂上通知：

```kotlin
class SyncService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notice = buildOngoingNotification()
        startForeground(NOTICE_ID, notice) // startForegroundService 之后必须很快调用
        scope.launch {
            try {
                sync()
            } finally {
                stopForeground(STOP_FOREGROUND_DETACH)
                stopSelf(startId)
            }
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
```

清单里声明与真实工作一致的 `foregroundServiceType`，并准备通知渠道。Android 8 以前没有这套类型要求，高版本缺了会在启动时失败。

只想把接口给 Activity、不需要独立存活时用 bind：

```kotlin
class PlaybackService : Service() {
    private val binder = object : Binder() {
        fun player(): Player = engine
    }
    override fun onBind(intent: Intent?): IBinder = binder
}
```

边界一：应用已经在后台，仍调用 `startService`。系统直接抛异常，任务没开始。要先判断是否允许后台启动，或改成满足约束的 WorkManager。

边界二：`startForegroundService` 之后先去做网络，再 `startForeground`。几秒内没挂上通知，系统记 ANR。`startForeground` 必须在服务刚起来时就调用，网络放在它之后。

边界三：同时 start 和 bind，界面 `onDestroy` 里只 unbind，没 stop。服务继续跑，通知还在，用户已经离开。结束条件要写全：工作完成 `stopSelf`，绑定计数归零再销毁。

边界四：Binder 方法里直接读数据库。宿主在主线程调用，ANR 栈在宿主主线程的 Binder 调用上，不在服务进程的业务函数里。耗时接口做成异步回调，并在文档里写明线程。

## 画面（text 结构图）

```text
startService / startForegroundService
        │
        ▼
   onCreate（仅第一次）
        │
        ▼
   onStartCommand（每次 start 都来）
        │
        ├─ 前台：立刻 startForeground + 匹配的 type
        └─ 做完 stopSelf(startId)

bindService
        │
        ▼
   onBind → Binder
        │
   调用方拿到接口
        │
   unbind；若从未 start → 可以 onDestroy

后台限制：
  后台普通 startService        → 抛异常
  startForegroundService
        └─ 数秒内未 startForeground → ANR / 被停
  用户无感知的「保活」          → 不作为方案
```

## 常见坑与追问（至少 3 条）

1. **退到后台还要收 IM，是不是上一个前台服务？** 前台服务必须有用户能理解的通知，类型还要和真实工作一致。用来偷偷保活，通知会常驻，系统限制和审核都过不了。连接用前台时能建的通道，断线后退避重连。通话、正在播放这种用户知道的状态才用前台服务。

2. **`stopSelf()` 把后一次任务停掉了？** 每次 start 都有 startId。无参 `stopSelf()` 会停掉整个服务。并发或连续 start 时用 `stopSelf(startId)`，只在当前这次是最后一次时才真正停止。

3. **只 bind 不解绑会怎样？** ServiceConnection 还在，服务也还在，Activity 泄漏或服务无法销毁。绑定和解绑要成对，一般在 `onStart`/`onStop` 或 `onCreate`/`onDestroy` 成对出现，不要一边在 `onCreate` 绑、另一边在 `onStop` 解。

4. **IntentService 还能用吗？** 思想是串行后台队列，实现已经过时，同样躲不开后台限制。新代码用协程队列或 WorkManager。要跨进程死亡的上传不要放在页面 Scope 里。

5. **ContentProvider 里做初始化有什么问题？** Provider 在 Application 之前或紧随其后创建，跑在主线程。这里做网络、读大文件，冷启动和启动路径上的 ANR 都会变差。初始化排成任务图，没依赖的延后，可用 App Startup，而不是每个库一个 Provider。
