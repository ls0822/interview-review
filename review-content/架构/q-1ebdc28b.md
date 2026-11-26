---
id: q-1ebdc28b
type: qa
module: architecture
knowledge_ref: kp-arch-patterns
title: 页面有点击，不只是数据更新，MVI 怎么处理？
priority: P0
version: 1
---

## 问题
页面有点击，不只是数据更新，MVI 怎么处理？

## 答案
点击一律先变成 Intent。ViewModel 里看这个意图要改状态、做动作，还是两件都做。界面不自己发信令、不自己 Toast。

```kotlin
sealed interface Intent {
    data object NextPage : Intent    // 会改页码
    data object RaiseHand : Intent   // 主要是发信令和 Toast
    data object CopyRoomId : Intent  // 只复制，界面数据可以完全不变
}

data class State(val page: Int, val handRaised: Boolean)

sealed interface Effect {
    data class Toast(val text: String) : Effect
    data class Copy(val text: String) : Effect
}
```

```kotlin
fun onIntent(intent: Intent) {
    when (intent) {
        Intent.NextPage ->
            _state.update { it.copy(page = it.page + 1) }

        Intent.RaiseHand -> {
            _state.update { it.copy(handRaised = true) } // 按钮要变，才改 State
            viewModelScope.launch {
                signal.sendRaiseHand()
                _effect.send(Effect.Toast("已举手"))
            }
        }

        Intent.CopyRoomId ->
            _effect.send(Effect.Copy(roomId)) // State 不动
    }
}
```

界面上：

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

对照着记：

1. **点了要改屏幕上的数**（页码、加载中、按钮变灰）→ 更新 `State`，Compose 重组。
2. **点了只做一次**（Toast、跳转、复制、调系统分享）→ 发 `Effect`，`State` 可以不变。
3. **两件都要**（举手后按钮变灰，并且 Toast）→ `State` 和 `Effect` 都发。
4. 按钮点击涟漪这种纯外观，Compose 自己处理，不必做成 Intent。

「数据更新」只是 State 那一支。点击处理是入口，不是另一套架构。

---
