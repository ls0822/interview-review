---
id: kp-framework-roadmap
type: knowledge
module: framework
title: 三方框架掌握地图与复习顺序（专家）
priority: P0
version: 2
order: 1
---

## 一句话

三方框架面试讲「选型栈 + 依赖注入怎么绑生命周期 + 图片库怎么控内存与取消」；不是背 Glide API，而是能在 OOM、快速滑动、配置变更时说清库在帮你做什么。

**P0** 技术栈分层、`kp-di`、图片加载链路。**专家加分**是 KSP vs KAPT、大图与 Bitmap 复用、与 Coil 协程集成。

## 组成与结构

| 层 | 要回答的问题 | 主篇 | 档 |
|----|----------------|------|----|
| 栈全景 | 网络/图片/DI/存储各选谁、为何 | `kp-framework-stack` | P0 必会 |
| 依赖注入 | 图、作用域、与测试替换 | `kp-di` | P0 必会 |
| 图片加载 | 三级缓存、采样、生命周期取消 | `kp-image-loader` | P0 必会 |

顺序：`kp-framework-stack`（10）→ `kp-di`（20，模块在 architecture，但与栈同复习场）→ `kp-image-loader`（30）。

`kp-framework-stack` requires 含 `kp-arch-patterns`、`kp-di`——先懂分层再接栈。

P0：

- OkHttp + Retrofit/Room/协程是现代栈默认组合；选型讲 trade-off 不讲粉丝战。
- DI：Singleton vs ActivityRetained vs ViewModel scope；组件图在 Application 建。
- 图片：`override` 尺寸、RGB_565 vs ARGB_8888、`RequestManager` 跟 Fragment 走。

专家加分：

- Hilt 生成代码与编译期代价。
- Glide 内存缓存 vs 磁盘 vs 活动资源；Clears 与 `onLowMemory`。

## 原理

这一节讲清「栈选型边界、DI 作用域、图片内存峰值、请求取消、与模块化交界」。

### 1. 横切栈与业务边界（P0 必会）

OkHttp/Retrofit 管传输与适配；Room/SQLite 管结构化本地存储；协程管并发表达；图片库管解码与缓存。框架**不**替你做领域规则：库存扣减、权限判定仍在 domain。选型讲 trade-off：Coil 协程原生 vs Glide 生态；Hilt 编译期图 vs 手动 ServiceLocator 可测性。失败模式：在 ImageView 里手搓 HTTP 绕过库的生命周期与缓存，双倍内存与旋转重复下载。见 `kp-framework-stack`。

### 2. 依赖注入图与作用域（P0 必会）

对象图在编译期（Hilt/KSP）或运行期容器生成。`Singleton` 进程级；`ActivityRetained` 越过配置变更；`ViewModel` 与 UI 状态同寿；`Activity`/`Fragment` 更短。错误作用域：把 `Activity` 注入 `Singleton` 等价泄漏。测试用 `@TestInstallIn` / 手工 Module 替换 Fake。对比 Service Locator：全局 `get()` 隐藏依赖，测试要改全局。见 `kp-di`（architecture 模块，与栈同复习）。

### 3. 图片加载链与内存峰值（P0 必会）

链路：网络/磁盘 → 解码 → 变换 → 显示。`override` 目标尺寸采样，避免 4000px 图进 100dp View。RGB_565 vs ARGB_8888 质量与内存折半；GIF/超大图要特殊策略。三级缓存：活动资源、内存 LRU、磁盘。`onLowMemory`/`onTrimMemory` 应下发给库清理。失败模式：列表快速滑动仍解码全尺寸，GC 抖动。见 `kp-image-loader`（order 30）。

### 4. 生命周期绑定与取消（P0 必会）

`RequestManager` 跟 `Fragment`/`Activity` 走，页面销毁取消进行中的请求。`with(applicationContext)` 与 `with(fragment)` 差在取消边界；错绑导致 `You cannot start a load for a destroyed activity`。对比裸协程 `launch` 不跟生命周期：离开页面仍解码占 CPU。与 `kp-compose-interop` 嵌图：Compose 里 `remember` Glide/Coil request 对齐 dispose。

### 5. 网络栈与框架协同（P0 必会）

拦截器链做鉴权、公共头、日志；连接池与 `kp-okhttp` 细节在 network 模块。DI 提供单例 `OkHttpClient`，避免每接口一套 client。证书 pin 在 network 层配，业务层只关心 API。

### 6. 模块化下的依赖收敛（P0 必会）

`api` 模块暴露接口；`implementation` 里放具体 Retrofit Service 与 Room DAO。Feature 通过 Hilt 聚合 `@Module`，禁止 feature 互引实现。与 `kp-componentization` 同图：base-di 模块被各 feature 依赖。

## 使用与实践

1. `kp-framework-stack` — 白板画层。
2. `kp-di` — 讲 `@HiltViewModel` 与 Fake 测试替换。
3. `kp-image-loader` — 列表卡顿与缩略图策略。

交叉：`kp-okhttp`、`kp-net-optimize` 负责网络侧细节。

## 例子

```text
错：Glide load 原图 4000px 进 100dp ImageView
对：override + centerCrop + placeholder
错：Fragment 里用错 Activity 的 RequestManager
对：with(fragment) 自动取消
```

## 画面

```text
framework-stack (全景)
      |
      +----> kp-di (architecture)
      |
image-loader (内存/磁盘/生命周期)
```

## 常见坑与追问

1. **DI 单例持有 Context 是 Activity。** 追问：用 Application 还是 `@ActivityContext`？
2. **图片库当万能缓存。** 追问：磁盘缓存与 Room 重复？
3. **KAPT 全量重编痛点。** 追问：KSP 迁移边界？
4. **测试不替换网络层。** 追问：Fake 模块放哪？
5. **栈越叠越多。** 追问：什么叫「默认栈够用」？
