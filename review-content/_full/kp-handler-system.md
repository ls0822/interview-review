---
id: kp-handler-system
type: knowledge
module: android
title: Handler 消息机制
priority: P0
version: 3
order: 20
---

## 一句话

Handler、Looper、MessageQueue 是一套「线程自己的消息循环」：谁创建 Handler，消息就回到谁的线程上执行。主线程靠它刷新界面、处理输入；子线程要自己转消息，必须先准备 Looper。

## 组成与结构

一条线程最多挂一个 Looper。Looper 里有一条 MessageQueue。Handler 在构造时记住「当时线程的 Looper」，之后无论从哪条线程调用 `sendMessage` / `post`，消息都进这条队列。Looper 的 `loop()` 再把消息交回 `msg.target.dispatchMessage`。

| 角色 | 干什么 | 为什么单独存在 |
|------|--------|----------------|
| Looper | `loop()` 死循环取消息 | 线程默认不会自己回头执行别人丢过来的任务，需要一个常驻循环 |
| MessageQueue | 按 `when` 排序的单链表 | 延迟消息不能插到队尾就完事，必须按执行时间插入 |
| Handler | 入队和分发 | 调用方需要一个「寄到某线程」的地址；Message 的 `target` 就是它 |
| Message | what / arg / obj / callback | 一次投递的载体；用完回收进池，避免主线程狂分配 |

Message 有两条执行入口，进的是同一条队列：

1. `post(Runnable)`：填 `callback`，分发时直接 `run()`。
2. `sendMessage`：`callback` 为空，走到 `handleMessage`。

主线程在进程启动时已经做过 `Looper.prepareMainLooper()` 和 `loop()`，所以 `Handler(Looper.getMainLooper())` 可以直接用。子线程默认没有 Looper，`new Handler()` 会失败。

## 原理（深度，分步骤，讲清为什么）

**1. 为什么 `loop()` 是死循环却不把 CPU 打满**

`loop()` 不停调用 `MessageQueue.next()`。队列里没有到点的消息时，`next()` 在 native 层 `epoll` 上睡着，时间到了或有新消息入队才被唤醒。所以主线程的死循环是「等事件」，不是空转。触摸、绘制、生命周期回调，最终都是往这条队列塞消息。

**2. 一条消息怎么走完**

1. 调用方在任意线程执行 `handler.post` 或 `sendMessage`。
2. Handler 用自己绑死的那个 Looper 的队列，按 `when = now + delay` 插入链表。插入时要唤醒可能正在睡的 `next()`。
3. 目标线程的 `loop()` 取出这条 Message，调用 `msg.target.dispatchMessage(msg)`。
4. 分发优先级：Message 自己的 `callback` → Handler 构造时传入的 `Callback` → `handleMessage`。`post` 能跑，就是因为第一步命中了 `callback`。
5. 执行完把 Message 回收进池。池是为了主线程少 `new`。复用时如果没清空 `obj` / `callback`，下一次可能拿到脏数据，所以业务不要自己长期持有一条已经发出去的 Message。

**3. 为什么 Handler 会绑错线程**

Handler 在构造函数里读 `Looper.myLooper()`。在子线程里 `new Handler()` 且没 `prepare`，当前线程没有 Looper，直接抛异常。这是故意的：如果默默绑到主线程，调用方会以为任务在子线程执行，界面和锁都会乱。想在子线程处理消息，顺序必须是 `Looper.prepare()` → `new Handler()` → `Looper.loop()`。`loop()` 不会返回，它后面不要再写业务代码。`HandlerThread` 把这三步包起来：`start()` 之后线程里已经有 Looper，再用 `handlerThread.looper` 建 Handler。

**4. 泄漏为什么是一条链，而不是「Handler 本身很大」**

非静态内部类 Handler 隐式持有外部 Activity。消息还在队列里时，引用链是：

```text
主线程 MessageQueue → Message → target(Handler) → 外部 Activity → 整棵视图
```

Activity 已经 `onDestroy`，只要还有一条 10 秒后的消息，这条链就不断，Activity 回收不了。两步要一起做：

- Handler 做成静态内部类，需要 Activity 时用 `WeakReference`。弱引用解决的是「Handler 不硬拿着 Activity」。
- `onDestroy` 里 `removeCallbacksAndMessages(null)`。清消息解决的是「队列还指着 Handler」。只做弱引用、不清消息，消息仍会执行，执行时 Activity 可能已经是 null，界面更新变成空指针或更新到错误页面。

**5. 同步屏障为什么存在**

普通消息按时间排队。绘制如果也排在一条很慢的业务消息后面，这一帧就会掉。系统往队列插入一条没有 `target` 的屏障消息。屏障之后的同步消息先不执行，标成异步的消息可以越过屏障。Choreographer 用这个保证垂直同步、绘制相关消息能插队。业务代码不要自己插屏障：插错了，普通消息会一直被挡住，点击和生命周期都会停。

**6. IdleHandler 为什么适合「首帧之后」**

这一轮没有立刻要执行的消息时，队列回调 `IdleHandler`。首帧已经画完、用户还没操作，这时做一点延迟初始化，不跟启动抢主线程。回调里再做重活，空闲就结束了，下一次卡顿还是主线程的。它不是后台线程，只是「主线程暂时没别的事」。

主线程已经在 `loop()` 里，不要再为「让界面动起来」新开一个 Looper。子线程如果只是做完一次网络就 `post` 回主线程，用线程池或协程即可，不必为这一次任务准备 Looper。只有「这条线程要长期、按顺序消化消息」才用 HandlerThread。消息的 `obj` 若放大图或整段 JSON，会占着队列直到执行；大对象在后台处理完，消息里只带结果或 id。`post` 与 `sendMessage` 进同一条队列，重活 `post` 到主线程 Handler 仍会 ANR。

## 使用与实践

- 子线程结果回主线程：拿主线程 Handler `post`。新代码更多用协程 `withContext(Main)`，本质仍是往主线程调度器投任务，不要两套各写各的还互相等锁。
- 延迟和轮询：`postDelayed`。页面销毁必须 `removeCallbacksAndMessages(null)`，否则延迟任务打到已销毁的界面。
- 长时间、串行的后台队列：`HandlerThread`。它有自己的 Looper，任务一个一个执行，适合「必须按顺序处理」的会话写入。新项目若只是并发 IO，协程加 `Dispatchers.IO` 更常见；要活过进程死亡的任务用 WorkManager，不要用 Handler 假装保活。
- 跨进程不要用 Handler。Handler 只在本进程的线程之间寄信。跨进程走 Binder。主线程如果在 Handler 里做 Binder 同步调用，卡的是主线程，这和 ANR 是同一件事。
- `IntentService` 的思路是「队列加后台线程」，类已经过时。新代码用协程或 WorkManager。

## 例子（至少 1 个完整代码或伪代码块 + 边界场景）

主线程回写，销毁时把还没执行的消息清掉：

```kotlin
class RoomActivity : AppCompatActivity() {
    private val uiHandler = Handler(Looper.getMainLooper())

    private fun loadRoom() {
        thread {
            val name = queryRoomName() // 网络或磁盘，不在主线程
            uiHandler.post { titleView.text = name }
        }
    }

    override fun onDestroy() {
        uiHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
}
```

子线程自己消费消息时用 HandlerThread，避免忘了 `loop()`：

```kotlin
class SignalWriter : HandlerThread("signal-writer") {
    private val handler by lazy { Handler(looper) { msg -> handle(msg); true } }

    fun enqueue(body: String) {
        handler.obtainMessage(1, body).sendToTarget()
    }

    fun shutdown() {
        handler.removeCallbacksAndMessages(null)
        quitSafely()
    }
}
```

边界：Activity 已经 `onDestroy`，工作线程仍 `post` 了一条更新 View 的消息。如果只在 `onDestroy` 里清队列，清完之后才 post 的那条仍会执行。所以 post 之前要看页面是否还活着，或者 post 出去的 Runnable 里先判断 `isDestroyed`。弱引用让 Runnable 拿不到 Activity 时直接返回，避免更新到一个正在销毁的 View 树上。

另一条边界：`postDelayed(10_000)` 期间用户已经离开页面。不清消息，10 秒后 Runnable 仍持有 View。这就是上面那条泄漏链的实际触发条件，不是 Handler 对象本身泄漏。

错误对照：只做静态 Handler + `WeakReference`，`onDestroy` 不 `removeCallbacksAndMessages`——队列里延迟消息到点仍执行，可能 NPE 或更新已销毁页面。

## 画面（text 结构图）

```text
任意线程                         目标线程（创建 Handler 的那条）
  handler.post / sendMessage
        │
        ▼
  MessageQueue  按 when 插入
        │  无到期消息时 next() 休眠
        ▼
  Looper.loop()
        │
        ▼
  msg.target.dispatchMessage
        ├─ callback != null     → Runnable.run()     // post
        ├─ Handler.Callback     → handleMessage()
        └─ 默认                 → Handler.handleMessage()

泄漏链：
  MessageQueue → Message → Handler(非静态内部类) → Activity → View 树

屏障：
  [同步消息] [屏障(无 target)] [异步消息可越过] [同步消息被挡住]
```

## 常见坑与追问（至少 3 条）

1. **只把 Handler 改成弱引用就够了吗？** 不够。弱引用只断开 Handler 到 Activity 的硬引用。队列里的 Message 仍然指着 Handler，消息到点仍会跑。必须在销毁时 `removeCallbacksAndMessages(null)`。如果 Runnable 是匿名内部类，它自己也会持有 Activity，要一并清掉。

2. **主线程 `post` 一段 JSON 解析，算不算离开主线程？** 不算。`post` 只是入队，执行仍在创建 Handler 的那条线程。主线程 Handler 上的重活一样会卡顿、一样会 ANR。网络、磁盘、解码、大 JSON 要在入队之前就放到别的线程，回主线程只做赋值。

3. **同步屏障能不能用来让自己的消息优先？** 不能当业务手段。屏障是给绘制插队的。业务插一条没有 target 的消息，后面的点击和生命周期都会被挡住。优先绘制这件事系统已经做了。

4. **`IdleHandler` 里做初始化为什么有时更卡？** 它跑在主线程。首帧之后的「空闲」很短，里面做数据库或解码，空闲结束，下一次输入就排在它后面。只适合很轻的注册和预取触发，重活仍要丢到后台。

5. **子线程 `Looper.loop()` 后面的代码为什么不走？** `loop()` 在 `quit` 之前不返回。初始化和注册要写在 `loop()` 之前。退出用 `quitSafely()`，让已经到点的消息处理完，而不是 `quit()` 把队列直接丢掉。HandlerThread 的 `quitSafely` 就是这个语义。
