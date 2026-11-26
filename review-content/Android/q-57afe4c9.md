---
id: q-57afe4c9
type: qa
module: android
knowledge_ref: kp-activity-lifecycle
title: 生命周期：前台、旋转、进程被杀，三件事分开
priority: P0
version: 1
---

## 问题
生命周期：前台、旋转、进程被杀，三件事分开

## 答案
正常前后台：

```text
onCreate → onStart → onResume     可见并且在前台
onPause                             失去焦点，可能还看得见（弹了对话框）
onStop                              完全看不见
onDestroy                           要销毁了
```

透明主题的 Activity 盖上来时，底下的可能只到 `onPause`，不到 `onStop`。所以停动画、停相机不要只写在 `onStop`。

旋转屏幕默认是配置变更：旧 Activity `onPause → onStop → onDestroy`，新 Activity 再 `onCreate`。ViewModel 存在另一套存储里，按作用域留着，所以还是同一个对象，里面的 `StateFlow` 和 `viewModelScope` 都还在。界面要在新的 `onCreate` 里重新订阅。

`remember` 只在这次组合没有离开时保住值。旋转等于这段 Compose 拆掉重建，`remember` 丢了。`rememberSaveable` 把能放进 Bundle 的值交给系统，旋转和进程被杀之后能恢复。大对象、数据库连接不能塞进去。

进程被杀是第三件事。应用在后台，系统缺内存，把进程收掉。ViewModel 随进程一起没了。系统会把之前存下的 `savedInstanceState` 交给新进程的 `onCreate`。能恢复的是页码、滚动位置这种小状态。长连接、内存里的消息列表要重新建、重新拉。用户在最近任务里把应用划掉，系统不保证再给你恢复。

记三层寿命：

| 状态放哪 | 重组 | 旋转 | 进程被杀 |
|--|--|--|--|
| 普通局部变量 | 丢 | 丢 | 丢 |
| `remember` | 在 | 丢 | 丢 |
| ViewModel | 在 | 在 | 丢 |
| `rememberSaveable` / `SavedStateHandle` | 在 | 在 | 在（小数据） |
