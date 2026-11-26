---
id: kp-coroutine-basics
type: knowledge
module: coroutine
title: 协程模型：线程、挂起与续体
priority: P0
version: 6
order: 10
---

## 一句话

协程是跑在线程上的可挂起任务：挂起时把续体存下来并让出线程，阻塞才会占着线程干等；恢复时按 Dispatcher 找线程，不保证还是原来那一条。

## 组成与结构

```text
线程 = 工人，由操作系统抢占调度，真的执行指令
协程 = 工单，必须有工人才能往下跑
续体 Continuation = 书签：下一步从哪一行、局部变量是什么
挂起点 = delay / withContext / suspend 函数 / yield / await
```

协程没有自己的栈去跟内核线程竞争。一次挂起把需要的局部变量放进续体对象，函数返回一个特殊标记，线程立刻可以去跑别的协程。结果就绪后，调度器再挑一个符合 Dispatcher 的线程，从书签继续。

所以协程不消灭线程。`Dispatchers` 背后仍是主线程或线程池。主线程上如果调用阻塞式 Socket、大文件同步读，主线程照样卡，协程框架不会把这段变成挂起。

## 原理

1. **挂起和阻塞。** `delay(1000)` 登记一个定时，当前协程暂停，线程去干别的工单，时间到了再恢复。`Thread.sleep(1000)` 是这条线程进入 TIMED_WAITING，谁也用不了它。一百个阻塞请求往往要近一百条线程；一百个挂起等网络的协程可以挤在几十条线程上。等的是工单，不是工人。
2. **续体里有什么。** 编译器把挂起函数拆成状态机。遇到挂起点，把跨挂起点还要用的局部变量放进 Continuation，返回 `COROUTINE_SUSPENDED`。恢复时根据 label 跳到后半段。这就是「书签」的实现，不是把内核线程冻住。
3. **恢复不认线程号。** `withContext(Dispatchers.IO)` 花括号里在 IO 池的某一条线程上跑。花括号结束，下一行回到调用 `withContext` 之前的那个 Dispatcher。从主线程进来，下一行回主线程；IO 池里具体哪一条不保证不变。`Dispatchers.Main` 只有一条主线程，所以回到 Main 等于回到那一条。`Main.immediate` 多一个细节：当前已经在主线程时直接执行，不再往消息队列排一次。
4. **同一条线程上的交叉是协作式。** 工人同一时刻只干一张工单。没有挂起点，就不会换单。两个 `launch` 里都有 `delay`，常见顺序是先把两边挂起前的代码都跑完，再在 delay 之后继续。把 delay 换成不挂起的计算，第二个协程要等整段计算结束。这和两个线程不同：线程可以被时间片抢占，多核上还能真并行。
5. **紧循环会饿死邻居。** `while` 里只计算，同线程上的其他协程跑不到。这里两个检查点分工不同，别混成一个：
   - `yield()`：**让路给邻居**——挂起一下，让同 Dispatcher 上别的协程有机会跑，同时也是取消检查点。
   - `ensureActive()`：**只查自己还该不该跑**——发现已取消就抛 `CancellationException`，**不会**把执行权让给兄弟协程。
   对照：邻居被饿死 → 用 `yield()`（或带挂起的 `delay`）；只怕取消令来了还空转 → 至少 `ensureActive()`。两者常一起出现在紧循环里，但解决的不是同一个问题。若这段循环跑在 `Dispatchers.Default` 上并且占满所有工人，别的计算协程也会饿，所以还要限制并行度。
6. **优势不要夸大。** 等 IO 时少占线程、代码能从上往下写、Scope 取消能一起停，这些是真的。CPU 算力不会变多，多协程改同一变量照样要同步，`GlobalScope` 一样泄漏。

## 使用与实践

网络、磁盘、数据库用挂起 API 或 `withContext(Dispatchers.IO)`。纯计算用 `Dispatchers.Default`，并在循环里让出或检查取消。改界面回到 Main。

不要在主线程协程里直接调阻塞 IO。不要用 `Thread.sleep` 代替 `delay`，那会把 Dispatcher 的工人睡死，IO 池和 Default 池都会被拖瘦。

共享可变状态用 `Mutex` 或收进单线程调度器。协程切换不等于加了锁。

## 例子

```kotlin
val scope = CoroutineScope(Dispatchers.Main.immediate)

scope.launch {
    println("1-A")
    delay(100)          // 挂起，让出主线程
    println("1-B")
}
scope.launch {
    println("2-A")
    delay(100)
    println("2-B")
}
// 常见：1-A → 2-A → 之后才是 1-B、2-B

fun mainThreadLoad() {
    lifecycleScope.launch {
        val text = withContext(Dispatchers.IO) { readFile() }
        textView.text = text    // 回到 Main，不一定是 IO 里的那条线程
    }
}
```

把 `delay` 换成 `Thread.sleep`，主线程在第一次 sleep 就停住，`2-A` 和界面都动不了。换成不挂起的 `heavyCompute()`，`2-A` 会等到计算结束才打印。

## 画面

![协程模型：线程工人与协程工单](./assets/diagrams/coroutine-model.svg?v=2)

```text
一条线程（一个工人）
  工单1 跑到 delay -> 书签放下，工人空出
  工单2 跑到 delay -> 书签放下
  时间到 -> 按 Dispatcher 找工人，翻开工单1 的书签

没有挂起点：工单1 一直占着，工单2 排队
```

## 常见坑与追问

1. **把挂起说成阻塞。** 追问：`delay` 时线程状态是什么？工人可以去跑别的协程，不是 `sleep` 那种占着线程。
2. **认为恢复还在 IO 的同一条线程。** 追问：什么才保证同一条？只有 Main 这种单线程 Dispatcher。认 Dispatcher，不认线程号。
3. **同线程两个协程会抢占交叉。** 追问：死循环怎么办？没有挂起点就不会让出。加 `yield` 或 `ensureActive`。
4. **主线程里用了阻塞 API 还觉得协程能救 ANR。** 追问：谁在占主线程？那个阻塞调用本身。要换成挂起函数或丢到 IO。
5. **以为 `launch`/`async` 里调用的方法都是挂起函数。** 不对。块本身是挂起上下文（`suspend` lambda），所以**可以调用**挂起函数；但你写的普通 `fun foo()` 不会自动变成 `suspend fun`。只有声明了 `suspend` 的才是挂起函数。块里直接写的普通代码、普通方法，仍是同步跑完；没有挂起点就不会让出线程。
