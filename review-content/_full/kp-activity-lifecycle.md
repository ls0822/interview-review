---
id: kp-activity-lifecycle
type: knowledge
module: android
title: Activity 启动模式与生命周期
priority: P0
version: 3
order: 10
---

## 一句话

启动模式决定这次 Intent 是再压一个新实例，还是把已有实例拿到前台并走 `onNewIntent`。生命周期要拆成三件不同的事：前后台切换、配置变更导致的销毁重建、进程被系统杀掉。三件事能活下来的状态不一样。

## 组成与结构

任务栈是一组 Activity 的叠放，栈顶才是用户正在看的页面。启动模式和 `FLAG_ACTIVITY_*`、`taskAffinity` 一起决定新页面进哪个栈、要不要清掉上面的页面。

| 模式 | 栈里已有这个类时 | 新数据从哪拿 | 典型页面 |
|------|------------------|--------------|----------|
| standard | 再 new 一个，可叠多个 | 新实例的 `onCreate` | 普通详情，允许多开 |
| singleTop | 已经在栈顶：不 new，走 `onNewIntent`；不在栈顶：照样 new | 复用时必须 `setIntent` | 通知再点一次当前页，不要叠两层 |
| singleTask | 整个任务里已有：把它上面的页面都清掉，再 `onNewIntent`；没有才 new | 同上 | 主页、从推送回到首页 |
| singleInstance | 独占一个任务栈，栈里只有它 | 同上 | 来电这种必须单独成栈的，少用 |

正常生命周期：

```text
onCreate → onStart → onResume    可见并且在前台
onPause                          失去焦点，可能还看得见
onStop                           完全看不见
onDestroy                        要销毁了
```

`startActivity` 的面试版路径不是在本进程里直接 `new Activity`，而是跨进程绕一圈系统服务再回调回来。

## 原理（深度，分步骤，讲清为什么）

**1. 为什么启动要绕到 AMS**

任务栈、权限、进程是否还活着，都在系统进程里。应用进程只发请求。

1. 调用方 `startActivity`，经 Instrumentation 把 Intent 交给本进程的 ActivityManager 代理。
2. Binder 到系统进程的 ActivityManagerService。系统做校验、解析目标、决定栈怎么变，目标进程不在就先拉起进程。
3. 系统经 ApplicationThread 再 Binder 回应用进程。
4. 应用进程里由 ActivityThread 收到事务，Instrumentation 调到新 Activity 的 `onCreate` 及后续生命周期。

要记住的是「本进程请求 → 系统管栈 → 回调回本进程」。不必背每一层类名。进程是这时才可能被创建的，所以冷启动会比热启动多一段 Application 和进程初始化。

**2. 四种模式差别的本质是「实例和栈顶」**

standard 永远新实例，所以同一次点击的数据在 `onCreate` 的 Intent 里，没有 `onNewIntent`。系统没有复用旧对象。

singleTop 只解决「栈顶已经是我，别再叠一个」。通知点当前聊天页就是这个：再 new 一个，返回时要按两次才能出去。不在栈顶时它和 standard 一样会 new，因为上面还有别的页面，不能偷偷把下面那个实例抬上来。

singleTask 会把目标上面的页面弹出，那些页面会走 `onPause → onStop → onDestroy`。从推送进首页时，用户正在写的编辑页可能被清掉。这是产品要接受的代价，不是「复用一下而已」。主页、登录后的落地页常用它，就是希望栈回到一个已知根，而不是越叠越深。

singleInstance 独占任务栈，是因为这个页面和普通页面叠在一起会出现「返回进了别的 App 的页面」这类栈混乱。来电、强提醒才用，业务主页不要用。

**3. 为什么复用时必须 `setIntent`**

复用实例不走 `onCreate`。系统把新 Intent 交给 `onNewIntent`。如果这里不 `setIntent(intent)`，后面任何地方调用 `getIntent()` 拿到的仍是创建时的那一份。推送参数、房间号会一直是旧的。singleTop 和 singleTask 只要复用，就要在 `onNewIntent` 里更新 Intent，再刷新界面。

**4. 三件事的寿命不一样**

前后台：按 Home 或被别的不透明页面完全挡住，走 `onPause → onStop`，进程还在，ViewModel、内存里的连接都还在。回到前台是 `onRestart → onStart → onResume`，不会重新 `onCreate`。透明主题或对话框盖上来时，底下往往只到 `onPause`，不到 `onStop`。停相机、停动画如果只写在 `onStop`，这种情况下不会停。

配置变更（旋转是最常见的一种）：默认销毁重建。旧 Activity `onPause → onStop → onDestroy`，新 Activity 再 `onCreate`。ViewModel 存在另一套按作用域留着的存储里，所以还是同一个对象，里面的 `StateFlow` 和 `viewModelScope` 都还在。新界面要在新的 `onCreate` 里重新订阅。`remember` 只活在这次组合里，旋转等于这段 Compose 拆掉重建，值会丢。

进程被杀：应用在后台，系统缺内存，把进程收掉。ViewModel 随进程一起没了。系统把之前存进 `savedInstanceState` 的小数据交给新进程的 `onCreate`。页码、滚动位置可以恢复。长连接、内存里的消息列表必须重新建、重新拉。用户在最近任务里把应用划掉，系统不保证再走这套恢复。

| 状态放哪 | 重组 | 旋转 | 进程被杀 |
|----------|------|------|----------|
| 普通局部变量 | 丢 | 丢 | 丢 |
| `remember` | 在 | 丢 | 丢 |
| ViewModel | 在 | 在 | 丢 |
| `rememberSaveable` / `SavedStateHandle` | 在 | 在 | 在（只能是小数据） |

大对象、数据库连接、Socket 不能塞进 Bundle。Bundle 走的是系统保存的小 Parcel，超了会 TransactionTooLarge。

冷启动走「建进程 → Application → AMS 回调 → onCreate」；热启动只是已有任务栈回前台，与启动模式（例如 singleTask 是否在栈里复用实例）是两件不同的事。

## 使用与实践

- 登录页、主页、推送落地：优先 singleTask 或 singleTop，并写明「上面的页面会被清掉」是否可接受。普通可多开的详情用 standard。
- 推送、DeepLink 进 singleTask 页面：数据刷新放在 `onNewIntent`，不要只写在 `onCreate`。
- 旋转后还要的请求结果放 ViewModel。进程被杀后还要的页码放 `SavedStateHandle` 或 `rememberSaveable`。长连接不在这套恢复里，进程起来后按「断线重连」重新鉴权、补拉。
- 停摄像头、停传感器写在 `onPause`，不要只写 `onStop`，否则透明页盖上来时仍在采集。
- 标志位和启动模式会叠加。例如 `FLAG_ACTIVITY_CLEAR_TOP` 常和 singleTop 一起用来「回到栈里某个页面并清掉上面的」。面试先讲清四种模式，再补一句标志位会改栈，不要把两者说成互斥。

## 例子（至少 1 个完整代码或伪代码块 + 边界场景）

推送再点一次，当前页已经是房间页时不要叠两层，并且要换成新房间号：

```kotlin
class RoomActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val vm: RoomViewModel by viewModels()
        bind(vm)
        openRoom(intent) // 第一次创建，数据在这里
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)          // 不写这句，getIntent() 仍是旧房间
        openRoom(intent)
    }

    private fun openRoom(intent: Intent) {
        val roomId = intent.getStringExtra("roomId") ?: return
        viewModel.enter(roomId)
    }
}
```

清单里该页使用 `singleTop` 或 `singleTask`。singleTop 只在它已经是栈顶时复用；从别的页面点进来、栈顶不是它，仍会 new。若产品要求「全 App 只有一个房间页」，要用 singleTask，并接受它上面的编辑页被销毁。

边界一：旋转。`onCreate` 会再来一次，但 ViewModel 还是同一个。进房请求如果写在 Activity 字段里用普通协程，旋转后旧 Activity 取消、新 Activity 再请求一次，用户会看到闪一下。请求放 `viewModelScope`，界面只重新收集 StateFlow。

边界二：进程被杀后再进来。`savedInstanceState != null`，ViewModel 是新的，内存里的消息列表是空的。只能恢复房间号这种小状态，然后重新连接、补拉。把「旋转后 ViewModel 还在」说成「进程被杀也还在」是错的。

边界三：singleTask 从推送打开。栈是 首页 → 编辑页 →（目标是首页）。系统清掉编辑页，编辑页 `onDestroy`。用户没保存的草稿如果只在 Activity 字段里，就没了。草稿要在离开前写入 ViewModel 以外的存储，或者产品明确接受被清掉。

错误对照：只在 `onCreate` 里 `openRoom(intent)`，`onNewIntent` 不 `setIntent` 也不刷新——推送点同一页仍显示旧房间号，`getIntent()` 永远是首次创建时的 Intent。

## 画面（text 结构图）

```text
startActivity
  App 进程 ──Binder──▶ AMS（校验、管栈、必要时拉进程）
                         │
                         └──Binder──▶ ApplicationThread
                                        └── Instrumentation
                                              └── onCreate / onNewIntent …

栈（singleTask 复用首页）：
  [首页] [编辑页] [设置页]  + Intent(首页)
        ──清掉上面──▶  [首页]  并 onNewIntent
                       编辑页、设置页 onDestroy

状态能活多久：
  局部变量 < remember < ViewModel < SavedState / rememberSaveable
  重组能过    重组能过   旋转能过      进程被杀后小数据还能过
```

## 常见坑与追问（至少 3 条）

1. **singleTask 是不是只复用、上面的页面还在？** 不是。目标上面的 Activity 会被弹出并 `onDestroy`。从推送回首页时，正在编辑的页面可能直接没了。产品如果不能接受，就不要用 singleTask，改成 singleTop 或显式导航。

2. **`onNewIntent` 里忘了 `setIntent` 会怎样？** 复用的是旧实例，`onCreate` 不走。`getIntent()` 仍是第一次创建时的 Intent。后面读房间号、订单号都会读到旧的。刷新界面也要放在 `onNewIntent`，不能只放 `onCreate`。

3. **透明页盖上来，底下的相机为什么还在跑？** 底下可能只走 `onPause`，不走 `onStop`。只在 `onStop` 里释放相机，这种场景不会释放。采集、动画、传感器按「失去焦点」停，放在 `onPause`。

4. **旋转后请求打了两遍，或回调更新了已经销毁的 Activity？** 配置变更会销毁重建。请求和回调如果拿着 Activity，旧实例泄漏或崩溃。ViewModel 跨这次重建还在，界面在新 `onCreate` 里重新订阅。进程被杀后 ViewModel 不在，要靠 `savedInstanceState` 恢复小状态并重连。

5. **冷启动为什么比点开一个新页面慢？** 冷启动要创建进程、走 Application，再经 AMS 回调拉起第一个 Activity。热启动进程还在，只是把已有任务栈带到前台。这和启动模式无关，不要把 singleTask 说成冷启动优化。
