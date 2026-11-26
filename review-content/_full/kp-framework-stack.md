---
id: kp-framework-stack
type: knowledge
module: framework
title: 客户端主流三方分层（网络/图片/DI/路由等）
priority: P0
version: 3
order: 10
requires: [kp-arch-patterns, kp-di]
---

## 一句话

现在一面默认的客户端是单向数据流：界面只发事件、只画 State，ViewModel 调仓库，仓库再决定数据来自网络、数据库还是缓存。三方库按层选，能说清「为什么用它、不用什么」，没有落地过的不要说成自己的线上方案。

## 组成与结构

```text
Compose / XML
  只发事件，只画 State
ViewModel
  StateFlow，调用仓库
Repository
  网络、数据库或缓存
网络 / 数据库 / SDK
```

依赖只向下。界面不直接调 Retrofit，也不自己拼信令。

| 层 | 现在常用 | 面试时怎么说 |
|----|----------|----------------|
| 网络 | OkHttp，Retrofit 声明接口 | OkHttp 是事实标准。拦截器链负责重试、桥、缓存、连接。连接池复用 TCP。自研长连接不要和这个池说成同一条 |
| JSON | kotlinx.serialization、Moshi、Gson | 新 Kotlin 项目多序列化库或 Moshi；老项目 Gson。SDK 对外固定一种，不把实现库的异常抛给调用方 |
| 图片 | Glide、Coil | 存量 Glide 多。Coil 更贴 Kotlin 和协程。Fresco 只在特别大的图时提 |
| DI | Hilt、Koin | App 用 Hilt 编译期查错。Koin 运行时、上手快。SDK 不绑宿主的 DI |
| 存储 | Room、DataStore、MMKV | 消息和离线包索引用数据库。开关用 MMKV 或 DataStore。SharedPreferences 不用于频繁写入和多进程 |
| 异步 | 协程 + Flow | 老代码才是 RxJava。离开页面仍要完成的用队列或 WorkManager |
| 路由 | 自研或 ARouter 一类；模块内可用 Navigation | 跨模块用 path。Navigation 管单 Activity 的栈 |
| 后台 | WorkManager、前台服务 | WorkManager 能过进程死亡，有网络等约束，周期任务最短大约 15 分钟。前台服务要通知和类型，不为保活 |
| 启动 | App Startup | 避免每个库一个 ContentProvider |
| UI | Compose、ViewBinding | 新界面 Compose。XML 用 ViewBinding。少在新页面写 DataBinding 双向绑定 |

播放器现在说 Media3 那条线。数字人是 RTC 出画，不是自己用播放器播点播，被问到要分开。信令若是自定义二进制或 JSON，按实际说；Protobuf 的优点是比 JSON 小、有版本兼容，没在线上用就不要说用了。

## 原理（深度，分步骤，讲清为什么）

**1. 为什么要按层而不是按库**

库会换，层不会。今天 Retrofit 加 Gson，明天仍可以是 OkHttp 加另一种序列化，界面不应该改。分层是为了把「会变的实现」关在仓库下面。面试官问一个库，先说它坐在哪一层、替代它的是谁，再说你的项目用没用。

单向数据流和这套分层是同一方向：状态向下，事件向上，依赖向下。界面层出现 Retrofit 接口，层就破了，测试和替换都会碰到 UI。

**2. 网络层为什么是 OkHttp 加一层声明**

OkHttp 解决连接、TLS、拦截器和连接池。Retrofit 把「GET 这个路径、把 JSON 变成这个类型」变成接口方法，底下仍是 OkHttp。注解只是描述，转换器负责 JSON。把业务规则写进拦截器还是写进仓库，要有意识：公共头和签名放拦截器，和界面状态有关的判断放仓库或 ViewModel。

长连接 IM 如果是自己的 Socket，它和 OkHttp 池子是两套连接、两套重连、两套监控。混在一个「我们网络用 OkHttp」里，心跳断了会去查错误的池。

**3. 存储为什么要拆开**

消息、离线包索引需要查询和事务，用 Room。迁移要写，查询不要在主线程。一个布尔开关或轻量配置，用 MMKV 或 DataStore 更合适。MMKV 基于 mmap，读写快，也有跨进程方案。DataStore 是官方替代 SharedPreferences 的异步方案。SharedPreferences 的提交会卡，多进程不安全，老代码里还有，新写的频繁变化数据不要用它。

IM 的消息库和离线包的本地版本都落在这一层。SDK 对外不要暴露 Room 的 Dao，只暴露自己的查询接口，免得宿主依赖你的表结构。

**4. 后台任务为什么不能用 GlobalScope**

`GlobalScope` 和页面、进程都没有约定。进程被杀掉，协程没了，上传也没了，而且你没有约束（是否要网络、是否在充电）。WorkManager 把任务描述交给系统，进程没了还可以再调度，失败有退避，周期任务不能短于大约 15 分钟。用户正在看着的播放或通话才用前台服务，并且要通知和 `foregroundServiceType`。

上传如果只挂在 `viewModelScope`，用户一离开页面任务就取消。所以上传 SDK 自己有队列，队列的寿命跟任务走，不跟页面走。

**5. 图片、路由、DI 为什么是「横向能力」**

它们不属于某个业务模块。图片库全 App 一个，才能共享内存。路由全 App 一张表，DeepLink 和按钮才走同一条拦截器。DI 是组合根，决定上面这些东西各有一份还是按页面一份。放进某个业务模块里，别的业务就要依赖这个业务，组件化的箭头就反了。

**6. 没做过的怎么说**

简历上有的，用项目讲：Glide 或 Coil 按实际，上传和离线包按实际，Hilt 如果没用就说 SDK 是手动装配。简历上没有的，例如没在生产用过 KMP、没把播放器换成 Media3，就说知道它解决什么、什么情况下会选，不编造线上数据。Baseline Profile 和 Macrobenchmark 同理：知道用它量启动和滚动，项目里真正在看的是进房成功率和耗时分位，就这样说。

层一旦破了，换库就要改界面。所以 Composable 里不出现 Retrofit，Dao 不出现在 SDK 的公开包里，长连接的 Socket 也不塞进 OkHttp 的短请求池。存储按形态分：消息和离线包索引用 Room，开关用 DataStore 或 MMKV，频繁写入不要用 SharedPreferences。离开页面还要完成的上传进自己的队列或 WorkManager。没在线上用过的库只讲它坐在哪一层、和现有方案差在哪，不编造成功数字。

WorkManager 适合可以等、要活过进程死亡的任务，周期最短大约 15 分钟。用户正在看的播放才用前台服务。看板优先看成功率、耗时分位和错误码，这比只说用了哪个库更能说明问题出在哪一层。

短请求看 OkHttp 的成功率和分位耗时，长连接看在线率和重连次数。两条同时出问题时不要只查一个池子。

界面测试替换仓库或状态，不启动真的网络。

Protobuf 更小也更好做版本兼容，没在线上用就不要说用了。

## 使用与实践

画自己的栈时用课堂和 SDK 对上：小学界面是 Compose，收集 StateFlow；信令进 ViewModel 或底座，不进 Composable 函数体；上传和离线包对外是仓库或 SDK 接口；跨模块是 `app → 业务 → 中间件 → 基础`。路由是编译期 path 表。日志和监控从旁边挂上。

选一个新库时问四句：它坐在哪一层？进程被杀之后行为是什么？会不会强迫宿主接受它？团队已经有的封装能不能覆盖？能覆盖就不要为了新词再引一个。

工具能对上问题就行：LeakCanary 看泄漏链，Profiler 看 CPU、内存、网络，Perfetto 看 ANR 和掉帧时主线程在干什么，Layout Inspector 看重组次数，StrictMode 在开发期抓主线程磁盘和网络。线上看板是成功率、耗时分位、错误码 Top，这是排查时的第一份材料。

so 的交付记住 16KB 页对齐：Android 15 可以按 16KB 页运行，仍按 4KB 对齐的 so 会加载失败或影响上架。自己编的库和 RTC、MNN、FFmpeg 带进来的 so 都要查。

## 例子（至少 1 个完整代码或伪代码块 + 边界场景）

仓库是界面和 OkHttp 之间的唯一缝。上传不跟页面 scope 走：

```kotlin
class OfflineRepository(
    private val http: OkHttpClient,
    private val db: PackageDao,
    private val queue: UploadQueue,
) {
    fun observe(id: String): Flow<PackageState> = db.observe(id)

    suspend fun refresh(id: String) {
        val pkg = http.getPackage(id) // 只有仓库碰网络
        db.upsert(pkg)
    }

    fun upload(file: File) {
        queue.enqueue(file) // 离开页面也要跑完，不使用 viewModelScope
    }
}

@HiltViewModel
class PageViewModel @Inject constructor(
    private val repo: OfflineRepository
) : ViewModel() {
    val state = repo.observe(id).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), Empty)
}
```

界面只收集 `state` 并调用 `viewModel.refresh()`。测试时用一个内存里的假仓库，不启动 OkHttp。

边界一：Composable 里直接 `Retrofit.create(...).fetch()`。重组会重复请求，界面也没法在测试里替换网络。请求放仓库，由 ViewModel 触发。

边界二：消息存 SharedPreferences。条目一多，提交卡主线程，多进程还会丢。消息进 Room，开关进 MMKV 或 DataStore。

边界三：为了「统一网络」让 IM 长连接也走 OkHttp 的一次 GET 长轮询，又和连接池互相超时。短请求和长连接分开实现、分开打点，只在业务层统一成「收到一条消息」的接口。

边界四：宿主 App 用 Hilt，SDK 又要求 `startKoin`。两套组合根抢同一个对象。SDK 手动 init，App 在自己的模块里调用它。

## 画面（text 结构图）

```text
界面 Compose / XML
  事件向上，State 向下
ViewModel
  StateFlow + 一次性 Effect
Repository / SDK 接口
  ├─ OkHttp + Retrofit     短请求，连接池
  ├─ 自研 Socket / WS      长连接，独立重连
  ├─ Room                  消息、离线包索引
  ├─ DataStore / MMKV      开关和轻量配置
  └─ 上传队列 / WorkManager  寿命不跟页面

横向，不属于某个业务：
  图片 Glide/Coil
  路由 path 表
  DI：App 用 Hilt 或 Koin；SDK 手动装配
  日志、监控、StrictMode / Perfetto

换库不动界面
没做过的只讲选型，不讲成线上数字
```

## 常见坑与追问（至少 3 条）

1. **为什么界面不能直接调用 Retrofit？** 界面一碰网络，重组、旋转和测试都要面对真请求。仓库可以把网络换成缓存或假数据。依赖向下也要求界面不知道 OkHttp 的类型。

2. **长连接为什么不放进 OkHttp 连接池一起讲？** 池子复用的是短请求的 TCP。IM 或信令有自己的鉴权、心跳和业务 Ack，断了要走自己的状态机。放在一起讲，排查时会去看错误的连接。

3. **SharedPreferences、DataStore、MMKV、Room 怎么分？** 频繁变化和多进程不要用 SharedPreferences。轻量配置用 DataStore 或 MMKV。要查询和事务的消息、索引用 Room，并且不要在主线程查。SDK 不要把 Dao 暴露给宿主。

4. **离开页面还要传完的文件放哪？** 不放 `viewModelScope`，也不放 `GlobalScope`。放 SDK 自己的有界队列，或 WorkManager，并写清退避和网络约束。前台服务只用于用户能感知的持续工作。

5. **这些库都要说自己用过吗？** 不要。用过的讲项目里的位置和数据。没用过的讲它在哪一层、和现在这一层的差别、什么情况下会选。KMP、Media3、Baseline Profile 都按这个原则，不编线上结果。
