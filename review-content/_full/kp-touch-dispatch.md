---
id: kp-touch-dispatch
type: knowledge
module: android
title: 触摸事件分发与滑动冲突
priority: P0
version: 3
order: 30
requires: [kp-activity-lifecycle]
---

## 一句话

一次触摸从 Activity 进到根 ViewGroup，再往子 View 走。每一层都是先分发，ViewGroup 可以拦截，最后才是自己消费。滑动冲突就是「这一段位移该谁消费」，不是把事件方法背下来。

## 组成与结构

三个方法分工固定：

| 方法 | 谁有 | 职责 |
|------|------|------|
| `dispatchTouchEvent` | Activity、ViewGroup、View | 这一层收到事件，决定交给谁 |
| `onInterceptTouchEvent` | 只有 ViewGroup | 要不要把后面的事件截下来自己处理 |
| `onTouchEvent` | View 和 ViewGroup | 自己消费。返回 true 就不再往上传 |

传递方向：

```text
Activity.dispatchTouchEvent
  → 根 ViewGroup.dispatchTouchEvent
       → onInterceptTouchEvent ?
            不拦截 → 子.dispatchTouchEvent → … → 最里层 onTouchEvent
            拦截   → 自己的 onTouchEvent
```

没人消费就沿原路返回，父再决定自己是否消费。

`OnTouchListener` 在 View 的 `onTouchEvent` 之前。监听返回 true，View 自己的 `onTouchEvent` 不会走，点击往往也没了。点击不是一个单独的事件，是 DOWN 加 UP、中间没有明显移动，由可点击 View 识别出来的序列。

冲突时常用的三招：外部拦截（父在 `onInterceptTouchEvent` 里决定）、内部拦截（子调用 `requestDisallowInterceptTouchEvent(true)`）、嵌套滑动（NestedScrolling，让父子按协议协作而不是互相抢）。

## 原理（深度，分步骤，讲清为什么）

**1. 为什么先分发、再拦截、再消费**

系统不知道业务上谁该滑。它只保证事件从外向里送，每一层有机会说「从现在起我要了」。DOWN 是序列的开始。ViewGroup 在 DOWN 时决定把序列交给哪个子 View，后面的 MOVE、UP 默认仍先问这个子，除非中途拦截。

拦截看的是「剩下的事件」。DOWN 时如果父已经拦截，子连序列开头都收不到，子里的按钮就点不了。所以正常父布局在 DOWN 时不要拦截，等 MOVE 看出方向再截。一旦截下，子会收到一次 ACTION_CANCEL，用来收掉按下态，避免按钮一直停在按下。

**2. 返回值在说什么**

`onTouchEvent` 返回 true：这一层认了，父不用再处理。返回 false：这一层不认，事件交回父。ViewGroup 如果所有子都不消费，才会轮到自己的 `onTouchEvent`。

`onInterceptTouchEvent` 返回 true：父把序列从子那里拿走，后续 MOVE/UP 不再给子。返回 false：继续问子。这个方法默认 false，所以普通布局不会抢事件。

**3. 外部拦截为什么能分横竖**

父比子先看到 MOVE。父记下 DOWN 的坐标，MOVE 时算位移。横向超过阈值、并且横向明显大于纵向，就拦截，自己横滑。纵向更多就继续不拦截，让子去竖滑。阈值是为了躲开手指按下时的抖动，不然一点就抢，子里面的点击会失效。

这叫外部拦截：决定权在父。父清楚「我只吃横向」时最好用。父如果要等子先表态，就用内部拦截。

**4. 内部拦截为什么要子先开口**

子比父更知道自己能不能滑。例如竖向列表滑到顶了，再往下拉应该交给外层刷新。子在确认「这是我的方向，而且我还滑得动」时调用 `requestDisallowInterceptTouchEvent(true)`，父这一段不要截。子滑到边缘滑不动了，再把 disallow 设回 false，父才能接下一段。

父要配合：在 `onInterceptTouchEvent` 里如果子已经 disallow，就不要拦截。只调了子、父的拦截逻辑仍无条件返回 true，这句话没有用。很多父布局在 DOWN 时会清 disallow，子要在确认方向的 MOVE 里再 `requestDisallowInterceptTouchEvent(true)`。列表嵌套还要注意多指：用 `actionMasked` 和指针 id，不要假设永远只有 index 0。

**5. 点击为什么会被触摸吃掉**

`OnTouchListener` 返回 true 表示消费了 DOWN 到 UP 的整段，View 不再走 `onTouchEvent`，点击识别也就不会发生。要点击还在，监听里对不关心的事件返回 false，让 View 继续识别点击。长按、滑动同理，都是对同一段序列的不同解释，不是另一条事件管道。

**6. 嵌套滑动解决的是「协议」而不是再写一套拦截**

NestedScrolling 让子在自己消费之前和之后，把剩余位移报给父。父先有机会消耗一段（例如先折叠顶栏），子再滑自己的内容，子滑完还可以把剩下的再给父。CoordinatorLayout、AppBar 就是这条协议。能用嵌套滑动就不要在两层里各写一套互相矛盾的拦截。

父一旦在某次 MOVE 上拦截，后续 MOVE/UP 不再问子，子会收到 CANCEL；阈值和横纵比要一次定准，否则来不及把序列还给子。

## 使用与实践

先问产品：这段手势谁该赢。横向翻页包着纵向列表，通常是「横滑父吃，竖滑子吃」。列表到顶再下拉要刷新，用内部拦截或嵌套滑动，不要在父里写死「只要纵向就拦截」。

课堂这种 Compose 叠在课件 WebView / Cocos 上时，同样的问题换成层级：上层不需要吃事件的区域必须把触摸放下去，否则课件划不动。那是混排的命中区域，和 ViewGroup 拦截是同一类问题。

调试时看三件事：DOWN 落在哪个 View 上、第一次返回 true 的拦截发生在哪一层、子有没有收到 CANCEL。只看最后谁滑了，看不出是父抢走的还是子根本没消费。

## 例子（至少 1 个完整代码或伪代码块 + 边界场景）

外层横向翻页，内层纵向列表。父只在「横得足够明显」时拦截：

```kotlin
class HorizontalPager(context: Context) : ViewGroup(context) {
    private var downX = 0f
    private var downY = 0f

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = ev.x
                downY = ev.y
                return false // DOWN 不抢，否则子列表无法开始滑动、按钮也无法点击
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = abs(ev.x - downX)
                val dy = abs(ev.y - downY)
                if (dx > touchSlop && dx > dy) return true
            }
        }
        return false
    }
}
```

内部拦截的子列表，确认是纵向且自己还能滑时，禁止父拦截：

```kotlin
override fun onTouchEvent(ev: MotionEvent): Boolean {
    if (ev.actionMasked == MotionEvent.ACTION_MOVE && isVertical && canScrollVertically(direction)) {
        parent?.requestDisallowInterceptTouchEvent(true)
    }
    return super.onTouchEvent(ev)
}
```

边界一：父在 DOWN 就返回 true。子收不到序列，列表不滚动，按钮也不响应。拦截必须等到 MOVE 分出方向。

边界二：斜着滑，dx 和 dy 差不多。阈值判断如果写成「dx > 0 就拦截」，轻微斜滑也会把纵向列表截断。要同时满足超过 touchSlop 且横向占优。

边界三：父已经拦截之后，子收到 CANCEL。子如果在 DOWN 时做了按下高亮，CANCEL 里不恢复，界面会停在按下态。列表自己的实现一般会处理 CANCEL；自己写的按钮态要记得收。

边界四：`OnTouchListener` 为了「顺便打个日志」返回了 true。点击监听不再回调。日志监听必须返回 false。

## 画面（text 结构图）

```text
ACTION_DOWN / MOVE / UP
        │
        ▼
   Activity.dispatch
        │
        ▼
   父 ViewGroup.dispatch
        │
        ├─ onIntercept == true ──▶ 父.onTouchEvent
        │                              │
        └─ onIntercept == false        │ 子收到 CANCEL（若序列已开始）
                 │                     │
                 ▼                     │
            子.dispatch                │
                 │                     │
                 ├─ 子消费 true ────────┘ 父不再处理
                 └─ 子返回 false ──▶ 交回父.onTouchEvent

横竖冲突：
  父：MOVE 时 |dx| > slop 且 |dx| > |dy| 才拦截
  子：确认是自己的方向 → requestDisallowInterceptTouchEvent(true)
```

## 常见坑与追问（至少 3 条）

1. **为什么按钮在可滑动父布局里要点第二次才有反应？** 父在 DOWN 或很小的抖动时就拦截了，子没拿到完整的 DOWN+UP。父应在 DOWN 返回 false，MOVE 超过 slop 且方向明确再拦截。

2. **`requestDisallowInterceptTouchEvent(true)` 调了，父还是在抢？** 这句话只是子的请求。父的 `onInterceptTouchEvent` 如果无条件返回 true，请求不会生效。父要遵守 disallow。另外 DOWN 时父常会把 disallow 清掉，所以子要在 MOVE 里再次声明。

3. **`onTouch` 返回 true 之后 `onClick` 不来，是事件丢了吗？** 不是丢了，是被监听消费掉了，点击识别依赖 `onTouchEvent` 里的序列。监听只关心部分动作时要返回 false。

4. **两层都是纵向，拦截写得很乱怎么办？** 这是嵌套滑动的场景，不要两套拦截对着抢。用 NestedScrolling 把「父先消耗、子再消耗、剩余再给父」说清楚。面试讲清谁消费哪个方向，比背完整公式重要。

5. **Compose 盖在 WebView 上，课件滑不动？** 上层命中了手势的区域把事件吃掉了。不需要响应的区域要让事件落到下层容器。这和 View 体系里父拦截是同一类问题：谁先拿到序列，谁就能让下面收不到。
