---
id: kp-compose-vs-view
type: knowledge
module: compose
title: Compose 与 View 模型
priority: P0
version: 2
---

## 一句话

View 是命令式的：你找到控件，改它的属性，自己维持一棵和数据容易分叉的界面树。Compose 是声明式的：界面是「状态到界面」的函数，状态变了，框架重新执行相关函数，算出新界面，再把差异套到屏幕上。面试一句：View 是你改控件，Compose 是你改状态，界面自己跟上。

## 组成与结构

| | View | Compose |
|--|------|---------|
| 界面从哪来 | XML 或代码 `new` 出来的对象树 | `@Composable` 函数描述当前状态该长什么样 |
| 更新 | `findViewById`、`text = ` | 改状态，读到这块状态的函数重新执行 |
| 列表 | RecyclerView 加 Adapter | `LazyColumn`，按 key 复用 |
| 和数据的关系 | 控件里一份，内存里往往还有一份 | 以状态为唯一来源，界面是派生结果 |
| 查找控件 | `findViewById` | 没有这个步骤 |

课堂页可以同时有两套：课件容器是 H5 或 Cocos，用传统 View 嵌进来；工具条、连麦、数字人控制是 Compose。这不是「项目还没迁移完所以混用」，而是容器本身就是 View。混用的细节在互操作那一篇，这里先把两种模型分开。

页面级、要过配置变更的状态放 ViewModel。只活在这次组合里的，例如动画进度、列表滚动，用 `remember`。进程被杀后还要的小状态用 `rememberSaveable` 或 `SavedStateHandle`。

## 原理（深度，分步骤，讲清为什么）

**1. 命令式为什么会和数据分叉**

命令式的每一步都是在改已经存在的对象：把 TextView 设成第 3 页，把按钮设成灰色。中间如果有一条路径忘了改按钮，屏幕上的按钮和内存里的「已举手」就不一致。看代码时要搜索所有写这个 TextView 的地方，才能回答「页码现在是谁改的」。

旋转或重建时，这棵对象树被拆掉。你要在 `onCreate` 里按数据再设置一遍每个控件。漏一个，界面就是默认值。数据如果只存在控件里、没有单独的状态，重建之后就找不回来了。

**2. 声明式在计算什么**

Composable 函数的输入是状态，输出是「这一帧界面的描述」。页码是 3，函数就描述一个写着 3 的文本。页码变成 4，框架再次调用读到页码的那些函数，得到新的描述，再和上一帧比较，只把差异应用到屏幕上。

你不再持有 TextView 去改字。字是函数体里的 `Text("第 $page 页")`。所有会改页码的路径都写进那一份状态，界面只有这一处在读它。分叉会少，是因为没有第二份「控件上的页码」可以单独改。

**3. 为什么不是每次把整棵树拆掉**

重新执行函数不等于重新 `new` 所有 View。Compose 有一棵它自己的界面记录，重组时跳过没读到变化状态的分支，对上一次的记录做更新。所以它比「清空 `setContentView` 再inflate」便宜，但函数仍可能被频繁调用。频繁调用的函数里就不能做重活、不能直接发请求。重活放 ViewModel 或副作用里。

**4. 列表为什么不再写 Adapter**

RecyclerView 的 Adapter 是在命令式地创建、绑定、回收 ViewHolder。`LazyColumn` 只组合屏幕附近的项，滑出屏幕的项离开组合。这和「只绑定可见项」是同一目标。差别是你提供的是「第 i 项的状态该画成什么样」，不是「把这个 ViewHolder 的 TextView 设成某值」。

没有稳定的 key 时，插入一行，后面每一项的位置状态会串位，勾选和输入框会跑到别的行上。`key` 相当于稳定 id。不要在 `LazyColumn` 里再套一个会测量全部子项的竖直滚动布局，否则懒加载失效，一次把所有项都组合了。

**5. 状态提升在解决谁拥有数据**

子组件如果自己 `remember` 页码，别的组件就看不到，旋转策略也不好统一。状态提升是：状态由父或 ViewModel 持有，子只接收当前值和改值的回调。同一份页码可以同时驱动工具条和课件容器。预览和测试也可以直接传入页码，不必真的点按钮。

课堂里的课件页码、是否连麦，不要写死在某个按钮 Composable 里。收到信令的那一层改状态，按钮和容器一起变。

声明式不是「不能写命令」。点击回调、Bridge、滚动到某一行，仍然是命令，只是它们不能散落在各处改控件。命令的结果要写回那一份状态，下一次组合再把状态画出来。如果点击回调里既 `viewModel.nextPage()` 又去拿 WebView 直接翻页，状态和课件可能差一页。翻页应只改状态，由副作用观察页码再通知课件。

和 XML 共存时，不要两套都当数据源。老页面用 ViewBinding 拿控件没问题，但页码的真值仍放 ViewModel。`onCreate` 里根据状态设一次控件，之后只在观察回调里改。否则旋转重建会走 `onCreate`，而某次信令又直接改了旧控件，两边各记各的页码。

列表是两种模型差别最大的地方。RecyclerView 要写 Adapter，自己绑定和回收；LazyColumn 只描述可见项该长什么样，并用 key 把行内状态跟 id 绑在一起。没有 key，插入一行会把输入框串到别的行。不要在 LazyColumn 里再套一个会把所有子项都测量完的纵向滚动，否则懒加载失效，一次组合全部数据。新页面因此不再找控件，而是改那一份列表状态。

重组算出的是新的界面描述，不是把整棵 View 树拆掉再 inflate。没读到变化状态的函数可以跳过。重活和请求不要写在会反复执行的函数体里，否则一次重组就发一次请求。

状态提升之后，信令改的是那一份页码，工具条和课件容器一起变，而不是按钮里私藏一份。

老的 XML 页面用 ViewBinding 替代 findViewById，新页面不要再写一套双向绑定和状态对着干。

预览和测试可以直接传入页码，不必真的点按钮。

## 使用与实践

新界面默认用 Compose 描述。状态放 ViewModel 的 StateFlow，界面 `collectAsStateWithLifecycle()`。页面到后台不再收集，避免浪费和在不可见时更新。

老页面仍是 XML 时用 ViewBinding，替代 `findViewById`。DataBinding 在存量代码里多，新页面少写双向绑定，它和「状态向下、事件向上」拧着。不要在一个新页面里一半 DataBinding 写控件、一半 Compose 状态，两套来源会再次分叉。

列表用 `LazyColumn` 并提供 key。项里面不要读整个列表对象又在父布局读一遍同一个状态，否则父也会跟着重组。读取范围的细节在重组那一篇。

和课堂的关系：房间、页码、连麦是状态。信令进 ViewModel 改这些状态。工具条是 Compose。课件不是 `Text`，而是嵌进去的 View，但它翻哪一页仍由这份页码状态驱动。

## 例子（至少 1 个完整代码或伪代码块 + 边界场景）

页码只存在 ViewModel 里。按钮不自己保存一份：

```kotlin
@Composable
fun ClassScreen(viewModel: ClassViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    Column {
        Text("第 ${state.page} 页")
        Button(onClick = { viewModel.nextPage() }) { Text("下一页") }
        HandButton(raised = state.handRaised, onRaise = viewModel::raiseHand)
    }
}

@Composable
fun HandButton(raised: Boolean, onRaise: () -> Unit) {
    Button(onClick = onRaise, enabled = !raised) {
        Text(if (raised) "已举手" else "举手")
    }
}
```

对应的命令式写法要自己找到控件并记得每一处都改：

```kotlin
fun render(page: Int, raised: Boolean) {
    pageView.text = "第 $page 页"
    handButton.isEnabled = !raised
    handButton.text = if (raised) "已举手" else "举手"
}
```

边界一：在 `HandButton` 内部 `remember { mutableStateOf(false) }`。父组件收到信令把连麦状态改了，按钮仍显示自己那份 false。状态要提升到父或 ViewModel，子只接收 `raised`。

边界二：`LazyColumn` 不写 key，用户在第 3 行的输入框打了字，上面插入一条消息，字跑到第 4 行。给 `items` 提供稳定 id。

边界三：在 `ClassScreen` 的函数体里直接 `socket.send(nextPage)`。重组一次就发一次。发送必须放在点击回调或一次性副作用里，不能放在会反复执行的函数体里。

边界四：进程被杀。ViewModel 没了，`remember` 也没了。页码如果没进 `SavedStateHandle`，回来是第 1 页，还要重新进房。小状态提前放进可保存的位置，连接则走重连，不要假设 Compose 会把 Socket 保存下来。

## 画面（text 结构图）

```text
View（命令式）
  数据 ──你写代码改──▶ TextView / Button
  另一条路径忘了改 → 控件和数据分叉
  重建 → 必须再设置一遍控件

Compose（声明式）
  状态 ──函数计算出──▶ 界面描述 ──差异应用──▶ 屏幕
  改的是状态，不是控件
  没读到这次变化的函数可以跳过

状态放哪
  页面、要过旋转     ViewModel / StateFlow
  仅这一次组合       remember
  进程被杀还要的小字段  rememberSaveable / SavedStateHandle

列表
  RecyclerView + Adapter     绑定 ViewHolder
  LazyColumn + key           只组合附近的项
```

## 常见坑与追问（至少 3 条）

1. **Compose 是不是把 View 全部废掉了？** 不是。它换的是「谁来改界面」这件事。WebView、地图、RTC 画面、Cocos 仍然是 View，用互操作嵌进来。嵌进来之后，翻页、显隐仍由 Compose 的状态驱动，而不是两边各改各的。

2. **声明式是不是每次状态变化都把界面拆了重建？** 重新执行的是读到该状态的 Composable，用来算出新的描述。框架再把差异应用到已有记录上。没读到变化的分支可以跳过。它不是 `setContentView` 式的整页 inflate。

3. **为什么强调状态提升？** 状态藏在子组件里，别的块看不到，信令来了也无法一起变。父或 ViewModel 持有，子只拿当前值和回调，页码和举手按钮就不会各有一份。

4. **还有没有 `findViewById`？** Compose 树里没有。你不保存控件引用。老 XML 页面用 ViewBinding 拿引用。混用时，`AndroidView` 的 factory 里才会拿到那个传统 View。

5. **DataBinding 双向绑定能不能当作 Compose？** 它仍是在往控件上写、也从控件读。新页面用单向的状态更清楚：状态向下，点击向上。双向绑定和「一份 State 为准」容易拧着。
