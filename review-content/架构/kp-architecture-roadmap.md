---
id: kp-architecture-roadmap
type: knowledge
module: architecture
title: 架构掌握地图与复习顺序（专家）
priority: P0
version: 2
order: 1
---

## 一句话

架构面试要把「分层怎么卸耦、模块怎么不互相拖死、路由怎么解耦编译依赖、SDK 怎么对外承诺稳定性」串成一条治理链；MVVM/MVI 是落地手段，不是背诵名词。

**P0** 模式选型、组件化依赖方向、路由与 API 模块。**专家加分**是多端复用边界、版本兼容与破坏性变更策略。

## 组成与结构

| 层 | 要回答的问题 | 主篇 | 档 |
|----|----------------|------|----|
| 应用架构模式 | UI 状态、单向数据流、与协程收集 | `kp-arch-patterns` | P0 必会 |
| 模块化治理 | 组件 vs 模块、依赖倒置、发布 | `kp-componentization` | P0 必会 |
| 路由与解耦 | 模块间导航不直接 import 实现 | `kp-router` | P0 必会 |
| SDK 对外 API | 二进制兼容、隐藏实现、版本语义 | `kp-sdk-api` | P0 必会 |

学习顺序（与 order 一致）：先 `kp-arch-patterns`（10）建立 UI 分层与 Flow 收集语境 → `kp-componentization`（15）讲工程怎么拆 → `kp-router`（30）跨模块调用 → `kp-sdk-api`（40）把边界当产品。

P0：

- ViewModel 持有状态、View 订阅；单次事件不出 StateFlow 重复消费陷阱（交叉 `kp-flow-backpressure-android`）。
- 依赖只能指向更稳定的一层：feature → api → base，禁止环。
- 路由表/接口在 api，实现在宿主或运行时注册。
- SDK 暴露接口 + 语义化版本；内部 `internal` 不等于对外的承诺。

专家加分：

- 动态化与插件 ClassLoader 和 `kp-classloader` 的交叉一句。
- 模块化后编译指标：全量 vs 增量、接口模块对构建图的影响。

## 原理

这一节讲清「分层卸耦、单向状态、编译图治理、路由运行时、对外 ABI」各自的失败模式。

### 1. 分层与关注点（P0 必会）

UI 渲染与交互、领域规则、数据 IO 应可替换：换 UI（View→Compose）不动业务；换数据源（REST→Room）不动领域公式。Android 上**生命周期**决定订阅多久：比分层更先的是「谁在什么状态下收集」。对比「上帝 Activity」：所有逻辑塞 `onCreate` 导致不可测、不可并行。Repository 是边界，不是第二套业务层堆砌。见 `kp-arch-patterns`。

### 2. 单向数据流与状态归属（P0 必会）

事件/意图上行，不可变状态下行；UI 是状态的函数。MVVM：`ViewModel` 持有状态，View 订阅。MVI：intent→reduce→state 可还原，利于 debug，但样板多。单次副作用（Toast、导航）不要和持久 UI 状态混进同一 `StateFlow`——否则旋转重放（交叉 `kp-flow-backpressure-android`）。失败模式：Activity 里 `var list` 多处改写，状态源碎片化。见 `kp-arch-patterns`。

### 3. 模块化与依赖方向（P0 必会）

**模块**解决编译粒度；**组件化**还要求可独立集成与固定依赖方向：feature → api → base，禁止环依赖。`implementation` 不向外传递依赖；`api` 会把类型暴露给上游编译 classpath——泄漏实现类导致任何改 impl 全量重编。对比单仓巨石：改一行全网编。组件化换增量编译与职责清楚，代价是治理与路由成本。见 `kp-componentization`（order 15，在 patterns 之后）。

### 4. 路由与编译期解耦（P0 必会）

模块间导航不直接 `import` 对方 `Activity`：path/service 接口注册，运行时解析。未注册要有明确 fail（降级页、监控告警），不能无声 `ClassNotFoundException`。与深度链接对比：deeplink 是外部入口，路由是内部图。失败模式：字符串 path 散落，重构不改全仓。见 `kp-router`。

### 5. SDK 对外 API 与兼容（P0 必会）

对外是产品：语义化版本、变更日志、废弃周期。接口稳定 + 实现隐藏（`internal`/单独 module）。Kotlin `inline` 函数改体会把实现摊进消费者；默认参数顺序影响 Java 二进制。新增 sealed 分支可能是源码兼容但非二进制兼容。失败模式：把 `data class` 实现细节当 public API 发版。见 `kp-sdk-api`。

### 6. 与 DI、Compose 的交界（P0 必会）

依赖图在 Application/单测替换：`kp-di` 与组件边界同场。Compose 换渲染不换状态层；`kp-compose-vs-view` 仍依赖同一 `ViewModel`。架构面试串讲：搜索页状态流 + 模块 api + 跳转商品详情的路由表项。

## 使用与实践

1. `kp-arch-patterns` — 用搜索页讲 MVVM + StateFlow。
2. `kp-componentization` — 画 module 图，标 api/impl。
3. `kp-di`（framework 模块）常与此并行 — 组件如何拿到实现。
4. `kp-router` — A 模块跳转 B 不编译依赖 B 的 Activity。
5. `kp-sdk-api` — 对外发版 checklist。

与 `kp-compose-vs-view`：新 UI 仍要同一状态层；Compose 是渲染替换不是架构替换。

## 例子

```text
错：feature 直接 implementation 另一个 feature 的 Activity
对：api 里声明 IShopService，router 跳 path，impl 在宿主注册
错：SDK 把内部 data class 当 public API
对：DTO 稳定、实现包可见，变更走 major
```

## 画面

```text
arch-patterns (UI 状态层)
        |
componentization (模块与依赖)
        |
   router (跨模块)
        |
sdk-api (对外契约)
```

## 常见坑与追问

1. **把组件化等于多 module。** 追问：不能独立集成测试算组件化吗？
2. **路由字符串散落。** 追问：集中注册与版本演进？
3. **api 模块泄露实现类型。** 追问：返回值能用具体类吗？
4. **Global 单例当架构。** 追问：可测试性与替换？
5. **模式宗教战争。** 追问：列表页用 MVI 过度吗？
