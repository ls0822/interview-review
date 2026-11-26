---
id: kp-compose-recomposition
type: knowledge
module: compose
title: 重组与状态
priority: P0
version: 2
---

## 一句话

组合是第一次执行 Composable，建立起界面记录。重组是状态变了之后，只重新执行读到这个状态的那些函数。`remember` 挡住重组，挡不住旋转和进程被杀。页面要能画出来的当前值用 StateFlow 或 `mutableStateOf`，冷 flow 不行。

## 组成与结构

| 工具 | 挡住什么 | 挡不住什么 |
|------|----------|------------|
| 局部变量 | 什么都不挡，重组就回到初值 | — |
| `mutableStateOf` | 本身不保存位置，谁读谁订阅 | 要放在 `remember` 或 ViewModel 里才不会丢 |
| `remember` | 重组 | 旋转、进程被杀 |
| `rememberSaveable` | 重组、旋转、进程被杀 | 只能放进 Bundle 的小数据 |
| ViewModel / StateFlow | 重组、旋转 | 进程被杀 |
| `SavedStateHandle` | 和小数据保存相关，可跨进程死亡恢复 | 大对象、连接 |

`mutableStateOf` 是一块可观察的状态。谁在组合时读了它，它一变就重组谁。`derivedStateOf` 是由别的状态算出来的值，只有算出的结果变了才通知。滚动偏移用来决定「要不要出按钮」时适合它。

稳定性是编译器能不能确认「这个对象没变就不用进子组件」。可变 List、没标稳定的自定义类，编译器不敢跳过，子树会跟着重组。

## 原理（深度，分步骤，讲清为什么）

**1. 重组为什么能跳过一部分**

组合时，框架记下每个函数读了哪些状态。页码变了，只有读过页码的函数需要再执行。旁边一个只读房间名的文本，如果没读页码，就可以跳过。所以不是整页重跑，也不是每次把 View 拆了重建。

这也是「状态读得越靠下越好」的原因。父布局为了把页码传给子组件而读取了页码，父布局也读了这份状态，父也会重组。若把读取放进子组件内部，父只是把 State 对象传下去、自己不读 `.value`，父就可以不重组。传 lambda 让子自己读，是同一目的。

**2. 为什么函数体会反复执行**

重组是正常现象，滑动和动画时会更频繁。所以函数体里只能做「根据当前状态算出界面」。不能在函数体里发请求、写数据库、注册监听。那些在重组时会重复发生。请求放 ViewModel，监听放副作用。

重组也不是重绘。重组算出新的界面描述，绘制是后面把描述画到屏幕上。面试问「重组和重绘是一回事吗」，答案是不是。可以重组了但绘制阶段发现没有像素差异；也可以因为动画在绘制而并不是你的状态模型变了。查性能时先分清卡在反复重组，还是卡在重组之后的布局和绘制。

**3. `remember` 把值存在哪**

`remember` 把值存在这次组合的记录里，和这个函数在树里的位置绑在一起。重组时位置还在，值就还在。旋转或离开组合，记录被拆掉，`remember` 的值一起走。所以它适合滚动位置、动画，不适合「旋转后页码还在」。

`rememberSaveable` 把能放进 Bundle 的值交给系统的保存机制。旋转和进程被杀之后能恢复。数据库连接、Socket、大图不能塞进去，Bundle 也有大小限制。

ViewModel 在配置变更时由另外的存储留着，所以 StateFlow 还在，`viewModelScope` 也还在。新的界面重新收集就能画。进程被系统杀掉时，ViewModel 随进程消失。那时只有 `savedInstanceState` 里的小数据还在。用户从最近任务划掉应用，系统不保证恢复。

**4. 为什么页面状态要用有当前值的容器**

`StateFlow` 和 `mutableStateOf` 都有「现在的值」。新的收集方或第一次组合，立刻能读到页码。冷的 `flow { }` 要等下一次发射，收集之前没有当前值。用它当页面状态，旋转后的第一帧不知道画什么。

`collectAsStateWithLifecycle()` 把 StateFlow 收成 Compose 状态，并且页面到了后台就停止收集。这样不可见时不会为了更新界面做事，也不会在不合适的生命周期里碰界面。

**5. 稳定性、key、派生状态分别减少什么**

不可变数据类如果字段都是稳定类型，编译器可以在入参没变时跳过这个 Composable。类里放一个 `ArrayList` 并且就地 `add`，外面看是同一个引用，内容变了，跳过就会错，于是编译器选择不跳过，重组范围变大。做法是改完列表就给一个新的不可变列表，而不是在旧列表里加元素。

`LazyColumn` 的 `key` 让「这项的 remember」跟着 id 走，而不是跟着第几行走。没有 key，位置一变，状态就串行。

`derivedStateOf` 解决的是「输入经常变、输出很少变」。滚动每像素都变，但「是否显示回到顶部」只在越过阈值时变一次。直接在组合里读滚动位置，每像素都重组；用派生状态，只有布尔值翻转才重组。

**6. 怎么确认是重组过多**

Layout Inspector 可以看重组次数。先看是不是父组件读了不该读的状态，再看数据是不是不稳定，然后才是派生状态和跳过。不要先到处加注解。

跳过重组的前提是入参稳定。数据类字段如果都是稳定类型，编译器可以在入参没变时不进这个函数。字段里放一个可变列表并原地 add，引用没变、内容变了，跳过就会画出旧数据，所以编译器选择不跳过，父一重组子树全跟着走。改完就换成新的不可变列表。滚动这种高频输入用 derivedStateOf 收成很少变化的布尔值，避免每像素都重组整页。

remember 只跟这次组合走，旋转会拆掉组合，值就没了。要过旋转放 ViewModel；要过进程被杀，只把能进 Bundle 的小字段放进 rememberSaveable 或 SavedStateHandle。连接和整份消息列表要重新拉，不在这套恢复里。

收集页面状态用 collectAsStateWithLifecycle，到后台就停止收集，避免不可见时还在更新。

不要用冷 flow 保存页码，它没有当前值。

## 使用与实践

页面状态进 ViewModel 的 StateFlow：页码、是否连麦、加载中。Composable 里只用 `remember` 保存滚动和动画。需要过进程死亡的页码，同时写进 `SavedStateHandle`，进房后的长连接不在这里恢复。

收集用 `collectAsStateWithLifecycle()`。不要在 Composable 里 `lifecycleScope.launch { flow.collect }`，那会在重组时重复启动，而且和组合的进入离开对不齐。

列表提供 key。传给子组件的列表用不可变结构。滚动阈值用 `derivedStateOf`。信令来了在 ViewModel 里改 State，不要在组合函数里改一份本地副本。

查卡顿时先用重组次数确认范围，再用常规的布局和绘制工具看是不是测量太重。重组频繁但函数很轻，不一定是瓶颈；重组里做了解码或大对象分配，就是瓶颈。

## 例子（至少 1 个完整代码或伪代码块 + 边界场景）

页码放 ViewModel，滚动和「是否显示按钮」分开。父组件不读页码的具体值：

```kotlin
@Composable
fun ClassScreen(viewModel: ClassViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    val showJump by remember {
        derivedStateOf { listState.firstVisibleItemIndex > 2 }
    }
    LazyColumn(state = listState) {
        items(state.messages, key = { it.id }) { msg ->
            Text(msg.text)
        }
    }
    if (showJump) {
        Button(onClick = { /* 滚动到顶 */ }) { Text("回到顶部") }
    }
    PageLabel(page = state.page)
}
```

子组件自己读状态对象，避免父布局为了传一个 Int 而订阅：

```kotlin
@Composable
fun PageLabel(page: Int) {
    Text("第 $page 页")
}
```

若希望连父都不重组，可以把 `State<Int>` 传到子组件内部再读 `.value`。上面的写法在 `ClassScreen` 里已经读了 `state`，父仍会重组。这是边界，不是错误：页面本身就要随页码变化。真正要避免的是列表每一项都读整个页面 State。

边界一：`var page = 0` 写在 Composable 里，点击 `page++`。重组后 `page` 又从 0 开始，按钮看起来没反应。要用 `remember { mutableStateOf(0) }`，或者更好，放进 ViewModel。

边界二：`remember` 保存页码，旋转屏幕后回到初值。旋转拆掉了这次组合。要过旋转就放 ViewModel；还要过进程被杀就放 `rememberSaveable` 或 `SavedStateHandle`。

边界三：`items(messages)` 不给 key，`messages` 头部插入一条，每一行的输入状态错位。key 用消息 id，不用 index。

边界四：在组合里写 `val show = listState.firstVisibleItemIndex > 2`。滚动时父组件每次都重组。改成 `derivedStateOf`，只有越过阈值才变。

## 画面（text 结构图）

```text
第一次执行 Composable        组合，记下读了哪些状态
状态变化
  → 只重新执行读过它的函数   重组
  → 用新描述更新界面记录
  → 再绘制                     重绘（不是同一件事）

跳过的条件
  没读到变化的状态
  入参稳定且没变
  派生值没变（derivedStateOf）

寿命
  局部变量     重组就丢
  remember     重组还在，旋转丢
  ViewModel    旋转还在，进程死亡丢
  Saveable     小数据可过进程死亡

列表 key
  没有 key：状态跟着「第几行」
  有 key  ：状态跟着 id
```

## 常见坑与追问（至少 3 条）

1. **重组是不是整页重画？** 不是。只有读到变化状态的函数会再执行，没读到的分支可以跳过。执行函数是为了得到新的界面描述，也不等于把 View 拆掉重建。重组和重绘不是一回事。

2. **`remember` 旋转之后还在吗？** 不在。它只跟这次组合走。旋转会拆掉组合再重建。要过旋转用 ViewModel。要过进程被杀，用能进 Bundle 的 `rememberSaveable` 或 `SavedStateHandle`。Socket 和消息全量列表不在这套恢复里。

3. **为什么不能在 Composable 里 `lifecycleScope.launch` 去收集流？** 函数体在重组时会再执行，收集会重复启动。收集状态用 `collectAsStateWithLifecycle()`。进页面拉一次或订阅一段，用带 key 的副作用，离开组合时取消。

4. **父组件什么都没画，为什么还跟着重组？** 因为它读了那份状态，哪怕只是为了传给子组件。把读取移到子组件内部，父只传递状态对象而不读值，父就可以跳过。

5. **列表用可变 ArrayList 原地修改，界面不更新或更新过头？** 原地修改对 Compose 不一定是一次可观察的状态变化；就算换了新列表，元素类型不稳定也会让每一项都重组。用不可变列表整体替换，并为项提供稳定 key。
