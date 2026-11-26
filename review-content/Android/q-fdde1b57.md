---
id: q-fdde1b57
type: qa
module: android
knowledge_ref: kp-touch-dispatch
title: 事件分发和 Service，今天讲到能接住追问
priority: P0
version: 1
---

## 问题
事件分发和 Service，今天讲到能接住追问

## 答案
触摸从 Activity 进到根 ViewGroup，再往子 View 走。每一层的顺序是：

1. `dispatchTouchEvent`：这一层收到事件。
2. ViewGroup 才有 `onInterceptTouchEvent`：要不要截下来自己处理。
3. `onTouchEvent`：自己消费。返回 true 就不再往上交。

父要横滑、子要竖滑：父在拦截里看位移，横向超过阈值就拦截。或者子在确认是纵向时调用 `requestDisallowInterceptTouchEvent(true)`，让父这一段不要截。讲清「谁该消费这个方向」即可。

Service 两种启动。`startService` / `startForegroundService` 之后，服务自己活着，直到 `stopSelf` 或 `stopService`。`bindService` 是绑定，`onBind` 返回 Binder，调用方解绑且没有 start 过，服务可以销毁。Android 8 以后，应用在后台时不能随意 `startService`。用户能感知的持续工作用前台服务：先弹出通知，再 `startForeground`，高版本还要在清单里声明 `foregroundServiceType`（数据同步、媒体播放、连接设备等，类型要和真实工作一致）。IM 的连接保活不要讲拉起、双进程互拉。要讲就讲前台服务的合规条件，以及断线后的重连退避。

---

## 4. 语言
