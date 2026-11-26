---
id: q-08ae0f4b
type: qa
module: architecture
knowledge_ref: kp-arch-patterns
title: 四种放在一起怎么选？
priority: P0
version: 1
---

## 问题
四种放在一起怎么选？

## 答案
| | 点击之后谁干活 | 界面怎么变 | 适合 |
|--|----------------|------------|------|
| MVC | Activity 自己 | 自己改控件 | 只看老代码 |
| MVP | Presenter 再回调 View 接口 | `view.showX()` | 老项目 |
| MVVM | 界面调用具体方法，如 `nextPage()` | 订阅 State；一次性事件另走通道 | 多数新页面 |
| MVI | 界面只发 Intent，不点名方法 | 订阅唯一 State；动作走 Effect | 状态多、还要追「为什么变成这样」 |

简单设置页用 MVVM。切班、连麦、课件页码会互相影响时，收成一份 `State` 用 MVI，出问题可以把当时的 State 打出来。样板会多一点：每个按钮一个 Intent，外加 Effect。

单向流的好处：页面长什么样只由一份 State 决定，不会出现「这里改了按钮、那里又改了页码」对不上。代价是多写密封类。

---

## 4.2 组件化 · 模块化
