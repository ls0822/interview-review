---
id: kp-android-roadmap
type: knowledge
module: android
title: Android 掌握地图与复习顺序（专家）
priority: P0
version: 2
order: 1
---

## 一句话

Android 基础面试围绕「主线程消息循环 + 组件生命周期 + 输入事件链」：谁先收到回调、谁在什么状态下还能跑、什么操作会卡主线程变成 ANR。

**P0** 四条生命周期、Handler 模型、事件分发顺序、前后台组件边界。**专家加分**是 Choreographer 帧管线、Binder 粗粒度、与 Compose 生命周期的衔接句。

## 组成与结构

| 层 | 要回答的问题 | 主篇 | 档 |
|----|----------------|------|----|
| Activity 生命周期 | 配置变更、onSaveInstanceState 保存什么 | `kp-activity-lifecycle` | P0 必会 |
| Handler 体系 | Looper/Queue/主线程 | `kp-handler-system` | P0 必会 |
| 触摸分发 | dispatch、拦截、消费顺序 | `kp-touch-dispatch` | P0 必会 |
| Service 与后台 | 前台服务、启动式与绑定式 | `kp-service-bg` | P0 必会 |
| ANR | Input/广播/Service 超时阈值直觉 | `kp-anr` | P0 必会 |

P0：

- 生命周期回调在何线程：配置与窗口多在主线程。
- `post` 不是新线程；`Handler` 把任务排到目标 Looper。
- 事件从 Activity 到 ViewGroup 到 View；`onInterceptTouchEvent` 在父。
- 长时间工作在主线程 → 掉帧或 ANR，取决于类型。

专家加分：

- 多窗口/分屏下生命周期交错。
- `Choreographer` 与 vsync；大块 layout 测量次数。

## 原理

这一节把「主线程消息循环、组件状态机、输入责任链、后台政策、ANR 触发」拆开讲清边界与失败形态。

### 1. 主线程与消息队列（P0 必会）

`ActivityThread.main` 准备主 `Looper` 后进入 `loop()`：从 `MessageQueue` 取消息、执行 `Handler` 回调。Choreographer 的 vsync 回调也在此队列上排队——一帧内 measure/layout/draw 过长直接掉帧，不等于 ANR。对比子线程 `Looper`：`HandlerThread` 给后台任务单独队列，切 UI 必须 `post` 到主 `Handler`。失败模式：在 `onCreate` 里同步网络/大文件 IO，队列头被占，输入事件超时。见 `kp-handler-system`。

### 2. Activity 生命周期与配置（P0 必会）

生命周期回调描述 Window/可见性/可交互状态，不是简单的生死二元。`onSaveInstanceState` 在 `onStop` 前后时机因版本而变，Bundle 有大小限制，不适合塞大二进制。`ViewModel` 越过配置变更（同进程），不越过进程杀——`onCleared` 才释放。与 `Fragment` `onDestroyView` 对比：UI 销毁与逻辑持有者生命周期不一致。失败模式：在 `onDestroy` 后仍 `runOnUiThread` 更新已卸载体。见 `kp-activity-lifecycle`。

### 3. 触摸事件分发链（P0 必会）

事件自 `Activity.dispatchTouchEvent` 向下：`ViewGroup` 可先 `onInterceptTouchEvent` 截胡，子 `View` `onTouchEvent` 返回 false 则向上回溯寻找消费者。同一序列同一时刻只有一个消费者；`requestDisallowIntercept` 让子暂时禁止父拦截。滑动冲突：同向嵌套滚动用 NestedScrolling 协议，外层 `ViewPager2` 与内层 `RecyclerView` 是经典坑。与 Compose 指针输入对比：声明式命中是另一套，但「谁消费」问题同构。见 `kp-touch-dispatch`。

### 4. Service、前台与 WorkManager（P0 必会）

`startService` 与 `bindService` 生命周期与重入不同；后台启动限制使长时间任务倾向**前台服务**（必须显眼通知）或 `WorkManager`（可延迟、约束网络/充电）。音乐播放、导航、保活上传各选不同组合。失败模式：后台默默拉活被系统杀；前台无通知类型不符 policy。与协程 `SupervisorJob` 无关——组件生死由系统管。见 `kp-service-bg`。

### 5. ANR 类型与 watchdog（P0 必会）

Input dispatching timeout：主线程过久未处理输入。Broadcast timeout：`onReceive` 主线程过久。Service timeout：`onStartCommand` 等。检测靠 `ActivityManager` 与 traces，不是「你觉得卡」。与慢帧对比：掉帧可能仍能动，ANR 弹框。定位看 main 线程堆栈卡在哪——锁、IO、死循环、等待子线程 `join` 都是高频。见 `kp-anr`。

### 6. 与上层架构的交界（P0 必会）

生命周期感知收集：`repeatOnLifecycle` 防 `STOPPED` 后仍 collect（交叉 `kp-flow-backpressure-android`）。`Handler` 非静态内部类默认持有 outer Activity——内存泄漏经典。进程杀后恢复：别把临时状态只放内存，关键态要持久化或接受重置。

## 使用与实践

1. `kp-activity-lifecycle` — 旋转屏 walkthrough + ViewModel 范围。
2. `kp-handler-system` — `postDelayed` 泄漏 Activity 错例。
3. `kp-touch-dispatch` — 外层滑动内层点击冲突策略。
4. `kp-service-bg` — 音乐播放用哪种 Service。
5. `kp-anr` — 主线程读磁盘 vs 子线程。

与架构/协程衔接：UI 状态别在 `onDestroy` 后更新；收集 Flow 用 `repeatOnLifecycle`（见 `kp-flow-backpressure-android`）。

## 例子

```text
错：onCreate 里同步读 50MB 配置 → 启动 ANR 或严重掉帧
对：子线程/协程 IO + 主线程 apply
错：非静态 Handler 内部类默认持外部 Activity
对：静态 + WeakReference 或 viewModelScope
```

## 画面

```text
lifecycle (组件谁活着)
     |
handler (主线程队列)
     |
touch-dispatch (谁吃事件)
     |
service-bg ---- anr (卡多久出事)
```

## 常见坑与追问

1. **onPause 里做重活。** 追问：可见性与可交互差在哪？
2. **以为 Service 一定新进程。** 追问：默认与 Activity 同进程？
3. **`requestDisallowIntercept` 滥用。** 追问：子 View 想独占滑动时？
4. **忽略 onSaveInstanceState 大小限制。** 追问：大数据该放哪？
5. **把 ANR 只等于主线程卡死。** 追问：广播超时算吗？