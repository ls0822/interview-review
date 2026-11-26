---
id: kp-compose-interop
type: knowledge
module: compose
title: Compose 与 View 混用
priority: P0
version: 3
order: 40
requires: [kp-compose-recomposition, kp-compose-side-effects]
---

## 一句话

Compose 里嵌传统 View 用 `AndroidView`，factory 里创建，update 里把新状态写进去。老页面嵌一块 Compose 用 `ComposeView`，并设置 `ViewCompositionStrategy`，避免泄漏。课堂的课件是 H5 或 Cocos，走 `AndroidView`；工具条是 Compose。上层不需要吃触摸的区域要把事件放下去。

## 组成与结构

两条方向：

| 方向 | API | 谁管理寿命 |
|------|-----|------------|
| Compose 包 View | `AndroidView(factory, update)` | factory 创建一次；离开组合时按策略释放 View |
| View 包 Compose | `ComposeView.setContent` | 要跟 View 树的生命周期走，常用 `DisposeOnViewTreeLifecycleDestroyed` |

小学课堂的三层：底层课件容器（H5 或 Cocos，`AndroidView`），中间数字人与动画，上层 Compose 工具条。房间、页码、连麦是状态。信令改状态，Compose 重组。需要翻课件时，由副作用按新页码调用 Bridge，而不是在组合函数体里直接调。

Bridge 只负责和课件通信：方法白名单、线程切换、参数校验，避免任意反射。进房时模型和动画还在下载，界面用状态画出「加载中」，下载结果再改状态，不阻塞重组本身。

## 原理（深度，分步骤，讲清为什么）

**1. 为什么 factory 和 update 要分开**

传统 View 的创建很贵，而且它自己带着滚动位置、WebView 的页面历史。如果每次重组都 `WebView(context)`，页面会白屏并重新加载。`factory` 只在这个 `AndroidView` 进入组合时调用，用来 `new` 出 View。

状态变了要改这个已经存在的 View，例如把页码写进容器、改 URL。这是 `update`。重组时 `update` 会带着最新参数再执行。所以 `update` 必须幂等：同样的页码写两次不能把课件翻乱，也不能重复 `loadUrl` 把 H5 刷新掉。

创建时才能做的事放 factory，例如 `settings.javaScriptEnabled`、加 Bridge。跟状态有关的放 update。把 `loadUrl` 放在 factory 里，之后页码变了不会再走 factory，课件就不翻页。

**2. 为什么 ComposeView 会泄漏**

Compose 的组合要在合适的时机 dispose，才能取消 `LaunchedEffect`、解开监听。`ComposeView` 如果跟窗口的默认策略不一致，View 已经从界面拿掉了，组合还在，协程还在收集。`DisposeOnViewTreeLifecycleDestroyed` 表示跟随 View 树的生命周期销毁，Fragment 或 Activity 的视图销毁时组合一起结束。策略设错时，旋转或从返回栈弹出之后，旧组合还持有 ViewModel 的收集和 WebView 回调。

**3. 触摸为什么要单独讲**

两套体系叠在一起时，上面的那一层先拿到触摸。Compose 工具条盖住课件，工具条的空白区域如果也参与命中，课件就收不到滑动。不需要点击的区域要让事件穿透到下面的 `AndroidView`。需要点击的按钮则正常消费。

这和 View 里父布局拦截是同一类问题：谁先命中，谁就能让下面收不到。面试时主动说「层级和事件」，比只说用了 `AndroidView` 更接近做过。

**4. 状态为什么仍只走 ViewModel**

WebView 的回调、Bridge 的 `onPageFinished`、信令的推送，都不要直接改 Composable 里的 `remember` 变量。那些回调可能在任意线程，也可能在重组过程中进来。统一写进 ViewModel，界面只观察 StateFlow。`update` 里读取的是已经收好的状态。

`StateFlow` 有当前值。旋转后 factory 会创建新的 View（如果组合重建了），update 立刻拿到当前页码，课件可以翻到该页，而不必等下一次信令。冷 flow 做不到这一点。

**5. 加载中为什么是状态而不是堵住组合**

模型和动画下载是 IO。堵在组合函数里，重组无法结束，界面也不能先画出工具条。ViewModel 把「下载中、进度、失败」放进 State。Compose 画出占位。下载结束改状态，`update` 或副作用再把资源交给 Cocos 或数字人。进房成功率和「含动态下载」的成功率要分开口径：小学这条含动态下载是 95%，和房间进房的 99% 不是同一个数。

**6. Bridge 为什么不能做成任意调用**

H5 调原生如果允许任意方法名和反射，页面里的脚本就能摸到不该摸的能力。白名单只暴露翻页、就绪、错误这几种。参数做校验。回调切回主线程再碰 View 或 ViewModel。Bridge 不是第二个业务层，它只搬运「课件和原生之间的消息」。

factory 只创建一次，所以 loadUrl 和翻页要放在 update，并且相同 URL 不要重复加载，否则举手这种无关状态一变，网页就被刷新，H5 自己的状态丢失。上层不吃事件的区域要穿透，否则课件滑不动。Bridge 回调进 ViewModel，不在 WebView 线程里直接改组合状态。下载中是一种状态，用来画占位，不能堵在组合函数里干等。

ComposeView 要跟视图树销毁走，否则 Fragment 已经不在了，组合里的协程还在收集。含动态下载的成功率和纯进房分开报，不要堵在组合里等下载。

相同页码不要重复 loadUrl。

创建 WebView 的配置放 factory，跟页码有关的调用放 update。

## 使用与实践

新功能优先写成 Compose。只有现成的重 View（WebView、地图、RTC 画面、Cocos）才用 `AndroidView`。不要为了迁就一个 TextView 去嵌 AndroidView。

`update` 里避免无条件 `loadUrl`。比较当前 URL 或页码，变了才调用。WebView 的销毁放在 View 被移除时，避免组合已经离开了页面还在播声音。

老页面只把工具条换成 Compose 时，用 `ComposeView`，设好销毁策略，Compose 里继续 `collectAsStateWithLifecycle()`。不要在 Activity 里同时手动 `observe` 同一份数据再 `setContent`，会双写。

触摸：工具条按钮可点，其余区域穿透。用一层透明却消费事件的 Box 盖住课件，是典型的「划不动」。

下载和进房并行时，界面先进入房间态并显示加载占位。下载失败有自己的状态，允许重试，不把整个房间状态机打回未连接，除非产品定义进房成功必须包含资源。

## 例子（至少 1 个完整代码或伪代码块 + 边界场景）

课件只创建一次，页码变化时由 update 写入。加载态在 Compose 里画：

```kotlin
@Composable
fun CoursePage(viewModel: ClassViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    Box {
        AndroidView(
            factory = { context ->
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    addJavascriptInterface(CourseBridge(viewModel), "Course")
                }
            },
            update = { web ->
                val target = state.pageUrl
                if (web.tag != target) {
                    web.tag = target
                    web.loadUrl(target) // 只有 URL 变了才加载
                }
            }
        )
        if (state.assetLoading) {
            Text("课件资源加载中")
        }
        ToolBar(
            onNext = { viewModel.onIntent(NextPage) },
            passThrough = true
        )
    }
}
```

从 XML 页嵌一块工具条时，策略要设上：

```kotlin
composeView.setViewCompositionStrategy(
    ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed
)
composeView.setContent {
    val state by viewModel.state.collectAsStateWithLifecycle()
    ToolBar(page = state.page, onNext = viewModel::nextPage)
}
```

边界一：`loadUrl` 写在 factory 里。第一次是第 1 页，信令把状态改成第 2 页，factory 不重新执行，课件停在第 1 页。加载必须放在 update，并自己做「没变化就不调用」。

边界二：update 里每次重组都 `loadUrl`。State 里别的字段变了，例如举手按钮变灰，网页被刷新，H5 的内部状态丢失。用 tag 或记住上一次 URL，相同则跳过。

边界三：上层全屏 Box 没有穿透。按钮能点，课件区域滑动没反应。把不需要的命中区域让出去，只让工具条上的按钮消费事件。

边界四：Bridge 回调在 WebView 线程里直接改 `mutableStateOf`。可能打在错误的线程上，也可能和重组交错。回调里只调 `viewModel.onBridge(...)`，由 ViewModel 切线程并改 StateFlow。

边界五：`ComposeView` 没设销毁策略，Fragment 视图销毁后 `LaunchedEffect` 仍在请求。返回再进来，旧请求和新页面一起改状态。策略要跟 View 树销毁走。

## 画面（text 结构图）

```text
课堂层级（上到下命中）
  Compose 工具条     按钮消费点击，空白穿透
  数字人 / 动画
  AndroidView        WebView 或 Cocos
        ▲
        │ factory 创建一次
        │ update 写入最新页码 / URL（相同则跳过）

状态
  信令 / Bridge 回调 → ViewModel → StateFlow
        → collectAsStateWithLifecycle → 重组
        → update 或 LaunchedEffect(page) 调课件

反向嵌
  XML / Fragment
    ComposeView
      setViewCompositionStrategy(DisposeOnViewTreeLifecycleDestroyed)
      setContent { 收集 State }

不要
  函数体里直接调 Bridge
  每次重组 loadUrl
  全屏透明层把触摸吃掉
```

## 常见坑与追问（至少 3 条）

1. **WebView 写在 factory 还是 update？** 创建和只做一次的配置放 factory。跟页码、URL 有关的更新放 update。factory 在重组时不会重来。update 要幂等，避免别的状态变化把网页重新加载。

2. **课件滑不动，是 WebView 坏了吗？** 多半是上面的 Compose 层把触摸吃了。不需要响应的区域要穿透，只保留按钮的命中。这和 View 父布局拦截是同一类问题。

3. **`ComposeView` 为什么要设 ViewCompositionStrategy？** 组合需要在 View 销毁时 dispose，副作用里的协程和监听才会取消。不设或设成跟窗口策略不一致，页面已经不在了，收集还在跑。常用的是跟 View 树生命周期销毁。

4. **Bridge 回调能不能直接改界面上的变量？** 不要。回调线程不一定是主线程，也不在组合的安全时机里。写进 ViewModel，界面只观察状态。Bridge 本身保持白名单和参数校验。

5. **资源还在下载，能不能在 Composable 里等到下载完再 return？** 不能。组合会堵住，工具条也出不来。下载进度放进 State，界面画加载中，完成后再改状态去更新 View。含动态下载的成功率不要和纯进房成功率混成一个数。
