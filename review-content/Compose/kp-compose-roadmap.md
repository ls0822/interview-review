---
id: kp-compose-roadmap
type: knowledge
module: compose
title: Compose 掌握地图与复习顺序（专家）
priority: P0
version: 2
order: 1
---

## 一句话

Compose 面试核心不是背 Composable 名单，而是「声明式 UI = 状态驱动重组 + 副作用有生命周期 + 与 View 混排有边界」；能讲清何时重组、谁订阅状态、Side-effect 放在哪。

**P0** 对比 View、重组与稳定性、副作用 API、互操作。**专家加分**是 Compiler 稳定性推断、slot table 直觉、性能取舍。

## 组成与结构

| 层 | 要回答的问题 | 主篇 | 档 |
|----|----------------|------|----|
| 范式对比 | 命令式 measure/layout/draw vs 状态→UI | `kp-compose-vs-view` | P0 必会 |
| 重组 | 什么触发、跳过条件、remember | `kp-compose-recomposition` | P0 必会 |
| 副作用 | LaunchedEffect、DisposableEffect 与生命周期 | `kp-compose-side-effects` | P0 必会 |
| 互操作 | AndroidView、ComposeView、混排 | `kp-compose-interop` | P0 必会 |

先修：`kp-arch-patterns`、`kp-coroutine-flow` 已写在子篇 requires 里；收集热流用 `collectAsStateWithLifecycle` 语境来自 `kp-flow-backpressure-android`。

P0：

- 状态上传、事件下传；Composable 入参变则重组子树。
- `remember` 跨重组保留；不带 key 的 remember 在调用点移动时会丢。
- `LaunchedEffect(key)` 在 composition 存活期间跑协程；key 变取消重来。
- 混排：谁拥有 Activity content、Z-order 与触摸。

专家加分：

- `@Stable` / `@Immutable` 对跳过重组的影响。
- 超长列表 `LazyColumn` 与 key、`derivedStateOf` 减无效重组。

## 原理

这一节讲清「快照重组、调用点身份、副作用生命周期、互操作测量、状态收集」的机制与错法。

### 1. 快照系统与重组（P0 必会）

Compose 用基于快照的状态：写入 `MutableState` 标脏，读过的 Composable 入队重组。重组是**重新执行** Composable 函数体，生成新 UI 描述，不是对单颗 View `invalidate`。与命令式 View 对比：View 树在屏幕常驻；Compose 描述可丢弃再算。跳过重组依赖稳定性：稳定入参、相等引用、compiler 的稳定性推断。失败模式：每次重组 `new` 大列表或无 `remember` 的重对象，掉帧。见 `kp-compose-recomposition`。

### 2. 调用点、Slot 与控制流（P0 必会）

Composable 调用位置决定 slot 身份；在 `if/for` 里改变调用顺序会错配状态（经典 counter 在条件分支乱跳）。正确做法：用 `key`、`AnimatedContent`、或把分支包进稳定子 Composable。与 React hooks 规则类比：顺序即身份。失败模式：在 `forEach` 里裸调 Composable 无 key，滚动乱状态。见 `kp-compose-recomposition`。

### 3. 副作用与 Composition 生命周期（P0 必会）

重组可频繁发生；**副作用**（订阅、注册监听、启动协程）不能写在 Composable 主体里无保护地执行。`LaunchedEffect(key)` 在 composition 存活期间启动协程，key 变则取消重来。`DisposableEffect` 在 onDispose 清理。`rememberCoroutineScope` 给事件回调用，生命周期仍受 composition 约束。对比 View：`onAttachedToWindow` 一次；Compose 要显式 key 对齐离开。失败模式：`LaunchedEffect(Unit)` collect 永不随生命周期停。见 `kp-compose-side-effects`、`kp-coroutine-builders`。

### 4. 互操作与测量约束（P0 必会）

`AndroidView` / `ComposeView` 在树中桥接两套布局：Compose 约束向下传递，`AndroidView` 的 `update` 在重组时跑。旧 View 测量惯性、双击、嵌套滚动要与 Compose 手势协调。失败模式：每次重组重建 WebView；或 AndroidView 高度写死导致旋转错位。见 `kp-compose-interop`。

### 5. 状态上、事件下与 Flow 收集（P0 必会）

状态单源在 `ViewModel`；Composable 只订阅渲染。`collectAsState` 无生命周期感知；界面收集应用 `collectAsStateWithLifecycle` 或 `repeatOnLifecycle`（`kp-flow-backpressure-android`）。一次性事件用 `SharedFlow`/`Channel`，不用 `StateFlow` 当前值机制。对比 MVP Presenter 直接握 View：Compose 仍要坚持状态归属在上层。

### 6. 性能与稳定性注解（专家加分）

`@Stable`/`@Immutable` 影响编译器跳过；`derivedStateOf` 减少无效重组。`LazyColumn` 必须稳定 `key` 才能保动画与状态。重组计数工具：Layout Inspector / 自定义 `Recomposer` 日志口述即可。

## 使用与实践

1. `kp-compose-vs-view` — 同屏列表演进度讲述两种心智。
2. `kp-compose-recomposition` — 数重组：stable 入参、lambda 捕获。
3. `kp-compose-side-effects` — 搜索 debounce 放哪层。
4. `kp-compose-interop` — 地图/WebView 嵌法。

串讲：登录页 State + 一次性错误 SharedFlow + `LaunchedEffect` 导航 One-shot。

## 例子

```text
错：每次重组 new ViewModel 或 new 大列表
对：上层 holder / remember + immutable list 引用稳定
错：LaunchedEffect(Unit) 里 collect 永不取消
对：lifecycle repeatOnLifecycle 或 DisposableEffect onDispose
```

## 画面

```text
compose-vs-view
      |
recomposition (何时重算)
      |
side-effects (协程与清理)
      |
interop (View 共存)
```

## 常见坑与追问

1. **以为 Composable 只执行一次。** 追问：状态变几次调几次？
2. **`remember` 当缓存宇宙。** 追问：进程杀死后呢？
3. **不设 Lazy list key。** 追问：滚动误动画？
4. **在 Composable 里直接开线程改状态。** 追问：snapshot 线程规则？
5. **互操作双触事件。** 追问：谁 dispatch 触摸？
