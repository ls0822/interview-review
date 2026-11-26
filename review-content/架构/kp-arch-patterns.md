---
id: kp-arch-patterns
type: knowledge
module: architecture
title: MVC / MVP / MVVM / MVI
priority: P0
version: 2
---

## 一句话

这四种都是一个页面内部怎么分工，不是组件化那种模块拆分。页面同时要画界面、响应用户、改数据和发请求。架构规定「用户点了一下」之后去哪，避免全部堆在 Activity 里。

## 组成与结构

用同一个课堂页比较。屏幕上有页码、一个「下一页」按钮、一个「举手」按钮。

- 下一页：点完，页码要变，课件要翻。这是界面数据更新。
- 举手：点完，给老师发一条信令，再 Toast「已举手」。按钮本身可以不变。这是一次动作，不是改一块数据。

| | 点击之后谁干活 | 界面怎么变 | 适合 |
|--|----------------|------------|------|
| MVC | Activity 自己 | 自己改控件 | 只看老代码 |
| MVP | Presenter 再回调 View 接口 | `view.showX()` | 老项目，要能讲 |
| MVVM | 界面调用具体方法，如 `nextPage()` | 订阅 State；一次性事件另走通道 | 多数新页面 |
| MVI | 界面只发 Intent，不点名方法 | 订阅唯一 State；动作走 Effect | 状态多、还要追为什么变成这样 |

Flow 和 Compose 不是 MVI 的定义。以前用 XML 加 LiveData，或者 RxJava，也叫 MVI。现在 Android 上的例子大多是 `StateFlow` 加 Compose，所以看起来像绑在一起。

三条线不要混成一个 Flow：

| 线路 | 用什么 | 为什么 |
|------|--------|--------|
| 界面数据 State | `StateFlow` | 有当前值。旋转、重组后还能画出页码 |
| 用户意图 Intent | 密封类；多了再进 `Channel` | 描述用户想干什么，不是数据本身 |
| 一次性效果 Effect | `Channel` 或 `SharedFlow(replay = 0)` | Toast、跳转做完即弃。放进 State 会再弹一次 |

## 原理（深度，分步骤，讲清为什么）

**1. 为什么要分，而不是把代码写整齐就行**

不分的时候，点击监听里既改 TextView，又发请求，又弹 Toast。旋转之后请求回调还拿着旧 Activity，轻则泄漏，重则更新到已经销毁的窗口。分工是规定交接点：谁持有数据、谁可以碰界面、谁在配置变更之后还活着。

**2. MVC 为什么在 Android 上会变成「全部在 Activity」**

Model 管数据，View 管控件，Controller 管点击和流程。Android 的 Activity 本身就是窗口和生命周期，于是 `setOnClickListener`、请求、`textView.text = ` 全写在里面。它既是 Controller 又是 View。

下一页就是 Activity 自己把页码加一，再改 TextView，再叫课件容器翻页。举手就是自己发信令、自己 Toast。能跑，几周后没人敢改。旋转时回调仍引用旧 Activity。老代码里常见，新页面很少再这么写。

**3. MVP 把判断挪走，为什么接口会膨胀**

Activity 只实现 View 接口。Presenter 持有这个接口，在里面算页码、发信令，再回调 `view.showPage`、`view.showToast`。Presenter 能单测，因为测的是「调用了 View 的哪个方法」，不必真的有一个窗口。

代价是每个按钮都在接口上加方法。`showPage`、`showToast`、`showLoading` 能堆出几十个。Presenter 如果在销毁后还持有 View，泄漏就从 Activity 转移到了 Presenter。所以用完要 `detach`，回调前看 View 是不是还在。现在新项目少用，维护老模块要能讲。

**4. MVVM 为什么不让 ViewModel 拿 View**

ViewModel 只暴露状态，界面订阅状态，自己决定怎么画。旋转后 ViewModel 还在，新界面重新订阅即可。它不持有 View，就不会把 Activity 留在逻辑对象里，这也是它能跨配置变更活着的原因。

下一页：界面调用 `viewModel.nextPage()`，里面把页码状态加一。Compose 收到新页码就重组，XML 则用观察者改 TextView。

举手仍调用 `viewModel.raiseHand()`。发信令是动作。Toast 不能塞进「当前页码」这种状态里，否则一重组、一旋转会再弹一次。所以旁边留一个一次性通道，`Channel` 或 `SharedFlow(replay = 0)`，界面收到才 Toast。按钮如果要变灰，那是状态，再改 State。

和 MVI 比，MVVM 允许界面知道方法名：`nextPage()` 和 `raiseHand()` 可以并存。简单页这样最清楚。

**5. MVI 把入口收成意图**

用户只发意图，逻辑只产出新状态或一次性效果，界面只负责画和转发点击。点击一律先变成 Intent。ViewModel 里看这个意图要改状态、做动作，还是两件都做。界面不自己发信令、不自己 Toast。

点了要改屏幕上的数，例如页码、加载中、按钮变灰，就更新 State，Compose 重组。点了只做一次，例如 Toast、跳转、复制、调系统分享，就发 Effect，State 可以不变。两件都要，例如举手后按钮变灰并且 Toast，就两个都发。按钮点击涟漪这种纯外观，Compose 自己处理，不必做成 Intent。

「数据更新」只是 State 那一支。点击处理是入口，不是另一套架构。单向流的好处是页面长什么样只由一份 State 决定，不会出现「这里改了按钮、那里又改了页码」对不上。代价是每个按钮一个密封类，样板多一点。

冷的 `flow { }` 没有当前值，不能当页面状态。旋转之后收集方需要立刻画出页码，只有 StateFlow 这种有当前值的容器能做到。Compose 用 `collectAsStateWithLifecycle()` 收 State，页面到后台就停止收集。

**6. 怎么选**

简单设置页用 MVVM，方法名比一套 Intent 清楚。切班、连麦、课件页码会互相影响时，收成一份 State 用 MVI，出问题可以把当时的 State 打出来。不要在一个页面里两种都写一半：一部分按钮直接改控件，另一部分走 State，对不上时没法判断谁是准的。

冷的 flow 没有当前值，不能当页码。旋转后的第一帧要能画出来，只能用 StateFlow 这种拿得到当前值的容器。

简单页用 MVVM 的方法名更清楚。

## 使用与实践

新页面默认：ViewModel 持有 StateFlow，界面只收集和转发。一次性事件用 replay 为 0 的通道。导航、Toast 不放进 State。

课堂页：页码、是否连麦放 State。举手、复制房间号走 Effect。信令回调写进 ViewModel，不在 Composable 里直接改字段。课件容器翻页可以由 State 里的页码驱动，Bridge 的调用放在副作用里，而不是写在组合函数的本体里。

老页面如果是 MVP，不要为了统一当场重写。能讲清 Presenter 必须 detach、接口为什么膨胀即可。MVC 的 Activity 只在改到那一块时再把请求和状态挪出去。

进程被杀后 ViewModel 不在，State 要靠 SavedStateHandle 恢复小字段，长连接重新建。这和选 MVVM 还是 MVI 无关。

## 例子（至少 1 个完整代码或伪代码块 + 边界场景）

MVI 把下一页、举手、复制分成三条路。举手既改按钮又弹 Toast：

```kotlin
sealed interface Intent {
    data object NextPage : Intent
    data object RaiseHand : Intent
    data object CopyRoomId : Intent
}

data class State(val page: Int, val handRaised: Boolean)

sealed interface Effect {
    data class Toast(val text: String) : Effect
    data class Copy(val text: String) : Effect
}

fun onIntent(intent: Intent) {
    when (intent) {
        Intent.NextPage -> _state.update { it.copy(page = it.page + 1) }
        Intent.RaiseHand -> {
            _state.update { it.copy(handRaised = true) }
            viewModelScope.launch {
                signal.sendRaiseHand()
                _effect.send(Effect.Toast("已举手"))
            }
        }
        Intent.CopyRoomId -> _effect.send(Effect.Copy(roomId))
    }
}
```

界面只转发点击，Toast 放在收集 Effect 的地方：

```kotlin
Button(onClick = { viewModel.onIntent(Intent.RaiseHand) }) { Text("举手") }
val state by viewModel.state.collectAsStateWithLifecycle()
Text("第 ${state.page} 页")
LaunchedEffect(Unit) {
    viewModel.effect.collect { effect ->
        when (effect) {
            is Effect.Toast -> showToast(effect.text)
            is Effect.Copy -> clipboard.copy(effect.text)
        }
    }
}
```

边界一：把 Toast 文案放进 State。旋转或重组时收集方再次看到这句文案，Toast 再弹一次。一次性事件必须走 replay 为 0 的通道，不能进 StateFlow。

边界二：举手的信令失败了，但 State 已经把按钮置灰。用户看到已举手，老师没收到。失败时要把 `handRaised` 改回去，或等 Ack 成功再改 State，并用 Effect 告诉用户失败。先改状态还是等成功，要和产品一致，不能一边灰一边没发出去还不说。

边界三：简单设置页硬套 MVI，每个开关一个 Intent，文件比页面还长。这种页用 MVVM 的 `setEnabled()` 更清楚。状态开始互相影响时再收成一份 State。

边界四：MVP 的 Presenter 在请求回来时没有看 detach。Activity 已经销毁，`view.showPage` 更新到旧窗口。回调第一行就要能丢掉这次结果。

## 画面（text 结构图）

```text
MVC
  点击 → Activity 自己改控件、自己发请求

MVP
  点击 → Presenter → view.showPage / showToast
  销毁时 detach

MVVM
  点击 → nextPage() / raiseHand()
  StateFlow → 界面自己画
  Channel(replay=0) → Toast 一次

MVI
  点击 → Intent
           ├─ 改屏幕上的数 → State → 重组
           └─ 只做一次     → Effect → Toast / 跳转 / 复制
  两件都要就两条都发

不要混进同一个 Flow：
  State 有当前值；Effect 做完即弃；Intent 是用户想干什么
```

## 常见坑与追问（至少 3 条）

1. **MVI 是不是必须用 Compose 和 Flow？** 不是。MVI 是单向流：意图进去，状态和一次性效果出来。XML 加 LiveData、或者 RxJava 也可以做。现在例子多用 StateFlow 和 Compose，只是因为它们好表达「有当前值」和「重组」。

2. **Toast 放进 State 会怎样？** State 会被新界面重新收集，旋转、重组都可能再弹一次。Toast、跳转、复制放 Effect，用没有重放的 Channel 或 SharedFlow。页码这种必须能画出来的才放 State。

3. **MVVM 和 MVI 怎么选？** 简单页让界面调用 `nextPage()` 这种方法，清楚。多个状态会互相影响、还要追「为什么变成这样」时，收成一份 State，入口改成 Intent。不要两种混在同一页。

4. **Presenter 为什么要 detach？** 它持有 View 接口，View 后面就是 Activity。请求回来时 Activity 可能已经销毁。不 detach 就会泄漏或更新旧界面。ViewModel 的做法是根本不拿 View，所以没有这一步，但进程被杀后 ViewModel 也不在了。

5. **冷 flow 能不能当页码？** 不能。`flow { }` 没有当前值，新的收集方要等下一次发射才知道页码，旋转后界面会空。页面状态用 StateFlow。
