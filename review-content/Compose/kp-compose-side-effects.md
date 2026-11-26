---
id: kp-compose-side-effects
type: knowledge
module: compose
title: Compose 副作用 API
priority: P0
version: 3
order: 30
requires: [kp-compose-recomposition, kp-coroutine-builders]
---

## 一句话

Composable 可能重组很多次，函数体里不能直接开协程、注册监听或发请求。`LaunchedEffect` 管「进来或 key 变了就跑一段可取消的协程」，`DisposableEffect` 管「进来注册、离开反注册」，`SideEffect` 管「每次重组成功后同步给外部对象」，点击开协程用 `rememberCoroutineScope()`。

## 组成与结构

| API | 什么时候跑 | 什么时候取消或清理 | 典型用途 |
|-----|------------|--------------------|----------|
| `LaunchedEffect(key)` | 进入组合，以及 key 变化 | 离开组合或 key 再变时取消上一段 | 进来拉一次、订阅一个流 |
| `DisposableEffect(key)` | 进入组合或 key 变化 | `onDispose` | 监听、传感器、回调注册 |
| `SideEffect` | 每次重组成功之后 | 没有取消回调 | 把最新状态同步给非 Compose 对象 |
| `rememberCoroutineScope()` | 你拿到的 scope，调用时才启动 | 离开组合时取消这个 scope | 按钮点击里启动协程 |
| `collectAsStateWithLifecycle()` | 组合期间按生命周期收集 | 页面到后台停止收集 | 把 StateFlow 变成界面状态 |

它们都不是用来保存页码的。页码是状态。副作用是「因为进入了组合，所以要和外面的世界做一次对接」。

## 原理（深度，分步骤，讲清为什么）

**1. 为什么函数体里不能直接做这些事**

重组会反复执行函数体。写在函数体里的 `registerListener` 会注册很多次；写在函数体里的请求会发出很多次；写在函数体里的 `launch` 会启动很多个协程。界面函数必须能被当成「用当前状态算一次描述」来重复调用。和外部世界的对接要放在只随进入、离开或 key 变化而触发的 API 里。

**2. `LaunchedEffect` 为什么跟 key 走**

第一次进入组合，它启动协程。key 不变的重组，协程继续跑，不会重新启动。key 变了，上一段协程被取消，用新 key 再启动。离开组合，协程取消。

所以「订阅这个房间的信令」可以用房间号当 key：换房间就取消旧订阅。key 用 `Unit` 表示整个组合期间只启动一次。不要把每次重组都会变的对象当 key，否则协程永远在取消和重启。

协程取消是协作的。里面如果吞掉 `CancellationException`，或者在一个不检查取消的死循环里，离开页面也不会停。网络请求要用能响应取消的实现。

**3. 点击为什么不用 `LaunchedEffect`**

点击不是「进入组合」这件事，而是用户动作。`LaunchedEffect` 没有一个「被点击」的时刻可以挂上去。`rememberCoroutineScope()` 给你一个跟组合寿命绑定的 scope，在 `onClick` 里 `scope.launch`。用户没点，就不会启动。页面离开，这个 scope 被取消，点击启动的任务也会被取消。

如果点击启动的工作必须在离开页面后继续，例如上传，就不要用这个 scope，也不要用 `viewModelScope` 假装能活过进程死亡。放到上传队列或 WorkManager。

**4. `DisposableEffect` 为什么要成对**

监听、广播、传感器都是注册一次就必须反注册一次。`DisposableEffect` 的主体里注册，`onDispose` 里解除。key 变化时先对旧 key 执行 `onDispose`，再对新 key 注册。没有 `onDispose`，就和在函数体里注册一样会漏。

它不适合拿来跑长协程。需要协程就用 `LaunchedEffect`。需要「注册一个回调」就用 `DisposableEffect`。

**5. `SideEffect` 为什么没有清理函数**

它在每次重组成功之后执行，用来把「当前状态」写到一个 Compose 不管的对象上，例如同步一个外部标志位。下次重组会再写一次最新值，所以一般不需要成对取消。不要在这里做请求或注册。如果写到一半重组失败，`SideEffect` 不会跑，这是它和写在函数体末尾的差别：它只在这次重组被提交之后执行。

**6. 和 ViewModel 收集的分工**

界面状态用 `collectAsStateWithLifecycle()`，不要自己在 `LaunchedEffect` 里 `collect` 再 `mutableStateOf` 赋值，除非有特别的转换。自己 collect 容易在 key 不对时重复订阅，也容易忘了生命周期。

一次性 Effect（Toast、导航）可以用 `LaunchedEffect(Unit)` 去 `collect` 那个没有重放的通道。这里用副作用是对的，因为 Toast 不是界面状态。注意通道不要用有重放的 StateFlow，否则一进来就把旧 Toast 再放一次。

Bridge 调课件也是副作用：页码状态变了，在 `LaunchedEffect(page)` 里告诉 WebView 翻页。不要在组合函数体里直接调 Bridge。线程如果必须在主线程，切回主线程再碰 View。

key 要用值，不要用每次重组都新创建的对象。`LaunchedEffect(roomId)` 在房间号不变时不会重启；`LaunchedEffect(Room(roomId))` 如果 `Room` 没有稳定的相等性，每一次重组都是新对象，协程就会一直取消再启动，订阅永远停在「刚开始」。数据类按字段相等，可以当 key；不要把 lambda 或没重写 equals 的类当 key。

离开组合时的取消要能传到真正的工作上。`LaunchedEffect` 里如果用 `thread { }` 而不是挂起函数，协程取消不会打断那条线程。网络要用可取消的客户端调用，循环要检查取消。否则页面已经走了，请求还在回调里改 ViewModel，下一次进房会看到上一个房间的结果。

点击启动的协程用 rememberCoroutineScope 或直接调 ViewModel。离开页面后仍要完成的上传不要挂在这个 scope 上，组合一结束它会被取消。key 只用房间号或页码这种值，不要用每次重组都新创建、又没有稳定相等性的对象。

LaunchedEffect 的协程取消是协作的。吞掉取消异常，或在不可取消的死循环里，离开页面也不会停。

SideEffect 没有清理回调，不能用来注册监听。

订阅用房间号当 key。

## 使用与实践

进来要拉一次数据：优先让 ViewModel 在初始化时拉，界面只收集 State。这样旋转不会因为重组而重拉，ViewModel 还在，请求还在。只有「这个 Composable 出现才需要、消失就要停」的订阅，才放 `LaunchedEffect`。

注册 Activity 回调、传感器、监听器，用 `DisposableEffect`，`onDispose` 里解开。点击发信令，用 `rememberCoroutineScope()` 或直接调 ViewModel 的方法，让 ViewModel 在 `viewModelScope` 里发。ViewModel 的方法更合适，因为旋转之后点击任务还可以在。

`SideEffect` 只做把最新值同步出去的轻操作。课堂里如果有一个非 Compose 的数字人控制器需要知道「当前是否连麦」，可以在 `SideEffect` 里把布尔值写给它，控制器不负责保存第二份会分叉的业务状态。

不要在这些 API 里做重活。它们多数仍从主线程启动。真正的网络和磁盘放在 Dispatcher 或 ViewModel 里。

## 例子（至少 1 个完整代码或伪代码块 + 边界场景）

页码变化时通知课件，点击用 scope，监听用可释放的效果。Toast 走单独通道：

```kotlin
@Composable
fun ClassRoom(viewModel: ClassViewModel, web: WebView) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    LaunchedEffect(state.page) {
        web.evaluateJavascript("flip(${state.page})", null) // key 是页码，重组不会反复翻
    }

    DisposableEffect(web) {
        val listener = object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) = Unit
            override fun onViewDetachedFromWindow(v: View) = Unit
        }
        web.addOnAttachStateChangeListener(listener)
        onDispose { web.removeOnAttachStateChangeListener(listener) }
    }

    LaunchedEffect(Unit) {
        viewModel.effect.collect { effect ->
            if (effect is ToastEffect) showToast(effect.text)
        }
    }

    Button(onClick = { scope.launch { viewModel.raiseHand() } }) {
        Text("举手")
    }
}
```

若 `raiseHand` 自己已经在 `viewModelScope` 里启动，点击里直接调用即可，不必再套一层 `scope.launch`。套两层没有好处，取消关系还会让人迷惑。

边界一：在函数体里写 `web.flip(state.page)`。每次重组都翻一次页，课件会闪，Bridge 会被打爆。放进 `LaunchedEffect(state.page)`，只有页码变了才调用。

边界二：用 `LaunchedEffect` 监听按钮。点击没有发生，协程却在进入页面时跑了，举手信令发出去了。点击必须写在 `onClick` 里。

边界三：`DisposableEffect` 里注册了传感器，没有 `onDispose`。离开页面后传感器还在回调，既耗电又可能更新已经离开的组合。注册和解除成对。

边界四：`LaunchedEffect(state)` 把整个状态对象当 key。任何一个字段变化都重启协程，里面的订阅被反复取消。key 只用真正决定这段协程的值，例如房间号或页码。

边界五：离开页面后上传必须完成，却启动在 `rememberCoroutineScope()` 里。离开组合，上传被取消。这种任务放上传队列，不跟界面组合绑定。

## 画面（text 结构图）

```text
组合函数体
  只计算界面。重组会反复执行，不能在这里请求或注册

LaunchedEffect(key)
  进入或 key 变了 → 启动协程
  key 再变或离开 → 取消上一段
  用途：订阅、按页码调用 Bridge 一次

DisposableEffect(key)
  进入 → 注册
  onDispose → 反注册

SideEffect
  每次重组成功后 → 把最新值同步给外部对象
  没有清理回调

rememberCoroutineScope
  onClick 里 launch
  离开组合才取消
  不是用来响应「进入页面」

页面状态收集
  collectAsStateWithLifecycle
  到后台停止
```

## 常见坑与追问（至少 3 条）

1. **为什么不能在 Composable 里直接 `lifecycleScope.launch`？** 函数体每次重组都执行，协程会重复启动，和「这个界面还在不在」对不齐。进入时启动用 `LaunchedEffect`，点击时启动用 `rememberCoroutineScope()` 或 ViewModel。

2. **`LaunchedEffect` 和 `rememberCoroutineScope` 怎么选？** 前者跟着进入组合和 key。后者用在点击、拖动这种用户动作里。把点击写成 `LaunchedEffect` 会在没点击时就执行。

3. **注册监听用哪一个？** `DisposableEffect`，在 `onDispose` 里解除。`LaunchedEffect` 适合协程，不适合「加一个监听器」这种必须成对的调用。`SideEffect` 没有解除回调，不适合注册。

4. **`LaunchedEffect(Unit)` 里收集 Toast，为什么一进来就弹了旧的？** 通道用了有重放的 StateFlow 或 replay 大于 0 的 SharedFlow，新的收集方会拿到上一次的 Toast。一次性事件用没有重放的 Channel 或 `replay = 0`。

5. **页码没变，Bridge 却一直被调用？** 调用写在了函数体里，或 `LaunchedEffect` 的 key 每次重组都是新对象。key 用页码这种值，重组但页码不变时协程不会重启。
