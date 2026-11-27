---
id: kp-coroutine-roadmap
type: knowledge
module: coroutine
title: 协程掌握地图与复习顺序（专家）
priority: P0
version: 8
order: 1
---

## 一句话

协程面试不是背 API 表：先讲清「挂起让出线程、恢复靠调度器」，再沿结构化并发把取消和异常走到根，最后用 Flow 和 Android 生命周期把数据接到界面。

**P0 必会**开口要对；**专家加分**是追问 why 时用的机制，日常写业务不必先背字节码。

## 组成与结构

按层记，不要按字母表记。每一层只回答一个问题，下一层默认上层已会。

| 层 | 要回答的问题 | 主篇 | 档 |
|----|----------------|------|----|
| 模型 | 协程和线程谁在干活，挂起时栈去哪了 | `kp-coroutine-basics` | P0 必会 |
| 调度 | 恢复发生在哪条线程，池子怎么被占满 | `kp-coroutine-dispatchers` | P0 必会 |
| 上下文 | 子协程继承什么、谁覆盖谁、CEH 装哪才有用 | `kp-coroutine-context` | P0 必会 |
| 结构化 | `launch` / `async` / `withContext` / Scope 谁在等谁 | `kp-coroutine-builders` | P0 必会 |
| 取消与异常 | 取消为什么停不干净，失败为什么会拆掉兄弟 | `kp-coroutine-cancel` | P0 必会 |
| 桥接回调 | 一次性回调怎么变成可取消的挂起 | `kp-callback-to-suspend` | P0 必会 |
| Channel / Mutex | 协程之间怎么交接数据、怎么保护可变状态 | `kp-coroutine-channel-mutex` | P0 必会 |
| Flow 冷热 | 冷流何时生产、如何升热 | `kp-coroutine-flow` | P0 必会 |
| 热流细节 | StateFlow / SharedFlow / replay | `kp-coroutine-state-shared-flow` | P0 必会 |
| Android 收集 | 背压、`stateIn`、页面停了谁还在跑 | `kp-flow-backpressure-android` | P0 必会 |
| 挂起实现 | 状态机、CPS、续体怎么被 Dispatcher 拦截 | `kp-coroutine-internals` | 专家加分 |

**关系一句：** 竖着走 P0 主路径能扛现场；横向某格答不上，只回读那一篇的对应单元，不要从头漫读。

## 原理

复习检查点：每条闭卷能口述例子。**是什么 → 看代码或手势 → 和谁有关 → 别混**。

### 检查点 1 · 模型（P0）

**是什么：** `delay` 让出线程；`Thread.sleep` 占工人。恢复不保证同线程，`Main` 像例外只因主线程一条。

**看代码：** `withContext(IO) { load() }` 下一行回到调用方 Dispatcher，不在 IO 工人上糊 UI。

**和谁有关：** `kp-coroutine-basics`。

**别混：** 紧循环无挂起点会饿死同线程邻居。

### 检查点 1b · `suspend` 到底挂谁（P0）

**是什么：** 挂起的是**调用它的协程**，不是「方法自己另开一条」。纯计算 `suspend` 往往一次不挂起；OkHttp `execute` 要 `withContext(IO)` 或 enqueue 桥；多接口并行靠 `async`，不靠标了 suspend。

**看代码：** `loadUser` 里只有 `for` 累加 → 仍占当前线程；`execute` 裸写在 Main 协程 → ANR。

**和谁有关：** `kp-coroutine-basics`、`kp-coroutine-builders`、`kp-callback-to-suspend`、`kp-coroutine-dispatchers`。

**别混：** `withContext` 有子 Job 但会等完；`launch` 才是旁路不等。

### 检查点 2 · 状态机哨兵（专家）

**是什么：** `suspend` → 状态机 + `Continuation`；`COROUTINE_SUSPENDED` = 真挂起，要上传。

**口述手势：** 挂起时栈空，书签在续体；局部变量跨挂起点在状态机字段。

**和谁有关：** `kp-coroutine-internals`。

**别混：** 不是说「轻量线程」占 1MB 栈。

### 检查点 3 · 调度与池（P0）

**是什么：** `viewModelScope` = `SupervisorJob + Main.immediate`。阻塞进 IO，CPU 进 Default。`limitedParallelism(n)` 限同时跑的协程，不新建 n 条 OS 线程。

**看代码：** IO 里 `Thread.sleep` 占阻塞配额；Default 里睡会把计算工人睡死。

**和谁有关：** `kp-coroutine-dispatchers`。

**别混：** 两个 `limitedParallelism(1)` 视图互不排队，可并行。

### 检查点 4 · 上下文合并（P0）

**是什么：** `+` 合并，同 Key 后写盖先写。子协程新建 Job 换掉背包里 Job；`launch(Job())` 断结构化。

**看代码：** `coroutineContext[Job]` 在子体内是自己。

**和谁有关：** `kp-coroutine-context`。

**别混：** CEH 在父还接手时**不响**。

### 检查点 5 · 结构化启动（P0）

**是什么：** `launch`/`async`/`withContext` 都新建协程。Scope≠协程，父 Job 是树根（parent↔children）。普通父连坐；监督不连坐但未处理可 CEH/崩。`coroutineScope` 捆绑等待；不能靠塞 SupervisorJob 变监督。

**看代码：** `viewModelScope.launch { coroutineScope { async…; async… } }`——外监督、内普通。

**和谁有关：** `kp-coroutine-builders`。

**别混：** `launch(SupervisorJob())` 换父断亲；`GlobalScope` 没有主人。

### 检查点 6 · 取消协作点（P0）

**是什么：** `cancel()` 改状态，下一协作点才抛 `CancellationException`。纯计算循环无 `delay`/`yield`/`ensureActive` 停不下来。

**看代码：** `catch (Exception)` 会吃取消。

**和谁有关：** `kp-coroutine-cancel`。

**别混：** `CancellationException` 不当业务失败传给父。

### 检查点 7 · 异常三条（P0 + 专家）

**是什么：** 普通父：子失败→父失败→兄弟取消。`async` 异常进 `Deferred`。`Supervisor`：兄弟不拆，未捕获才可能进子 CEH 或崩。

**和谁有关：** `kp-coroutine-cancel`、`kp-coroutine-context`。

**别混：** try 包住 `launch(...)` 接不住；`viewModelScope` 是监督父。

### 检查点 8 · 回调桥（P0）

**是什么：** 一次回调 `suspendCancellableCoroutine` + `invokeOnCancellation` 停底层。多次 `callbackFlow`。

**和谁有关：** `kp-callback-to-suspend`。

**别混：** `suspendCoroutine` 取消时仍等回调。

### 检查点 9 · Channel / Mutex（P0）

**是什么：** 容量 0 会合；`Mutex` 不可重入；锁里挂起不放锁；`Semaphore` 限协程并发。

**看谁有关：** `kp-coroutine-channel-mutex`。

**别混：** Channel 不是广播；`UNLIMITED` 堆内存。

### 检查点 10 · 冷热与背压（P0）

**是什么：** 冷流每次 `collect` 重跑；升热用 `stateIn`/`shareIn`。StateFlow 三规定、SharedFlow 的 replay 在热流篇。背压三件套：`buffer` / `conflate` / `collectLatest` 各牺牲不同东西。

**看代码：** `flatMapLatest` 绑搜索取消；`flowOn` 只改上游。

**和谁有关：** `kp-coroutine-flow`、`kp-coroutine-state-shared-flow`、`kp-flow-backpressure-android`。

**别混：** 冷热 ≠ 背压。

### 检查点 11 · Android 收集链（P0）

**是什么：** `stateIn(WhileSubscribed(5_000))` + `repeatOnLifecycle(STARTED)`：STOP 取消收集→订阅 0→超时停上游。Toast 不进 `StateFlow`。

**口述手势：** 旋转 5 秒内上游不断；停更久重跑冷流，StateFlow 先旧值。

**和谁有关：** `kp-flow-backpressure-android`。

**别混：** `launchWhenStarted` 不取消收集。

### 检查点 12 · 续体与 yield（专家）

**是什么：** Dispatcher 拦截 `resume` 故可换线程。`yield` 让出+检取消；`delay(0)` 不挂起。同线程切换只在挂起点。

**和谁有关：** `kp-coroutine-internals`。

**别混：** OS 抢占线程 ≠ 协程间抢占。

## 使用与实践

### 推荐复习顺序（每步 2–3 分钟口述）

**是什么：** 先自己讲，卡住再翻对应篇单元；标出 P0 句 vs 专家句。

| 步 | 读 | 口述任务 |
|----|-----|----------|
| 1 | `kp-coroutine-basics` | 百次等待为何不要百线程；紧循环饿死邻居 |
| 2 | `kp-coroutine-internals` | 哨兵、`yield` vs `delay(0)`、为何普通函数不能 suspend |
| 3 | `kp-coroutine-dispatchers` | `viewModelScope` 默认线程；IO/Default 分工；`limitedParallelism(1)` |
| 4 | `kp-coroutine-context` | 四元素 Key；CEH 何时响；`launch(Job())` |
| 5 | `kp-coroutine-builders` | launch/async/withContext；coroutineScope 等什么 |
| 6 | `kp-coroutine-cancel` | 协作点；supervisor vs scope；超时异常 |
| 7 | `kp-callback-to-suspend` | 为何 Cancellable；取消与回调谁赢 |
| 8 | `kp-coroutine-channel-mutex` | 容量；Mutex 重入；Semaphore |
| 9 | `kp-coroutine-flow` | 双 collect；何时 stateIn |
| 10 | `kp-coroutine-state-shared-flow` | StateFlow 三规定；replay；Toast 通道 |
| 11 | `kp-flow-backpressure-android` | 三种背压；SharingStarted；生命周期收集 |
| 11 | 回本篇画面 | 搜索+列表+Toast 串讲 8 分钟 |

**和谁有关：** 本篇检查点 1–12。

**别混：** 按 API 字母表复习会把取消层和 Flow 层拆断。

### 四套验收追问

**是什么：** 每遍用同一套问验收。

- 取消后还在跑？缺哪个协作点？
- 异常出：父取消没？CEH 为何响/不响？
- 现在在哪个 Dispatcher？挂起恢复还在吗？
- 值会重放、合并，还是只给一个消费者？

## 例子

第 11 步口述骨架（数字是结论，不是实现细节）：

```text
搜索：debounce + flatMapLatest(可取消 search) + flowOn(IO)
catch 在 stateIn 前 → StateFlow + WhileSubscribed(5_000)
界面 repeatOnLifecycle(STARTED)；Toast 旁路 SharedFlow(replay=0)
Supervisor：搜索自己 catch，不靠 CEH 弹 Toast
```

自测：任一句改「不用 X 会怎样」——如不用 `flatMapLatest` 旧搜索堵新关键字；不用 `WhileSubscribed` 退后台仍跑。

**错误对照：**

| 错法 | 现象 | 对法 |
|------|------|------|
| 用 `flatMapConcat` 接搜索 | 旧关键字慢请求堵在新关键字后面 | `flatMapLatest`，且请求可取消 |
| Toast 塞进 `StateFlow` | 旋转/重进又弹一次旧提示 | `SharedFlow(replay=0)` 或 `Channel` |
| 开场先背状态机标签 | 追问 `viewModelScope` 异常兄弟还在不在就断 | 先走本篇 P0 路径，机制放追问 |

## 画面

```text
P0 主路径（按序讲）

basics → dispatchers + context → builders ↔ cancel
  → callback → channel-mutex → flow → backpressure-android

专家下钻（追问再用）：
internals：状态机 / 哨兵 → 拦截 resume → yield vs delay(0)
```

## 常见坑与追问

1. **按 API 字母表复习。** `flatMapLatest` 和取消接不上？先走取消再 Flow。
2. **开场背状态机。** 先答 `viewModelScope` 异常兄弟还在不在。
3. **`delay(0)` 当 `yield`。** 见 `kp-coroutine-internals`。
4. **CEH 当 try/catch。** 子 launch、普通父不接；监督父未捕获才到 handler。
5. **StateFlow 装 Toast。** 新收集者拿当前值；用 `SharedFlow(replay=0)`。
6. **`limitedParallelism(1)` = 永远这条线程。** 挂起后工人可换；互斥在，ThreadLocal 不在。
7. **只背「协程不阻塞线程」。** `withContext(IO)` 里阻塞 SDK 仍占工人——是把阻塞关进有配额池子。