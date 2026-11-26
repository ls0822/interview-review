---
id: kp-di
type: knowledge
module: framework
title: 依赖注入 Hilt / Koin
priority: P0
version: 2
---

## 一句话

依赖注入是把「谁创建对象」从「谁使用对象」里拆出去，方便替换和测试。Hilt 在编译期生成，漏绑就编译失败，适合有 Application 的 App。Koin 在运行时用 Kotlin DSL 注册，上手快，错误要到运行才出现。对外 SDK 不要强迫宿主使用其中任何一种。

## 组成与结构

| | Hilt / Dagger | Koin |
|--|---------------|------|
| 什么时候决定依赖 | 编译期生成代码 | 运行时注册 |
| 出错时机 | 漏绑、循环依赖往往编译失败 | 取的时候才发现没注册 |
| 启动 | 生成好的表，路径清楚 | 启动时执行模块注册 |
| 学习成本 | 高，注解多 | 低 |
| 官方倾向 | Android 应用推荐 Hilt | 社区常用，KMP 场景比 Hilt 好接 |
| 适合 | 有 Application、模块多的 App | 想少注解、或没有 Hilt 那套组件的工程 |

Hilt 是在 Dagger 上包了一层，不用自己写 Component。常见注解：`@HiltAndroidApp` 标在 Application 上，`@AndroidEntryPoint` 标在 Activity 或 Fragment 上，`@Inject` 要一个依赖，`@Module` 和 `@InstallIn` 说明这组对象装到哪个生命周期，作用域有 Singleton、ActivityRetained 等。

Koin 用 `module { single { } ; viewModel { } }` 声明，在 Application 里 `startKoin`。没有注解处理器。

手动 DI 是组合根里写 `provide` 函数，界面通过构造参数拿依赖。小项目和 SDK 用这个更干净。服务定位器是全局 `get()`，能用，但隐藏了依赖，测试时要记得替换全局状态。

ButterKnife 是旧的 View 注入，已经退出主流。View 的引用用 ViewBinding，不要和依赖注入混成一件事。

## 原理（深度，分步骤，讲清为什么）

**1. 不注入时问题在哪**

Activity 里 `val api = Retrofit.Builder()...build()`，这个页面就和 Retrofit、基地址、拦截器焊在一起。测试想换成假的接口，只能真的发请求或重写整个 Activity。换一个 OkHttp 配置要改每一个 new 出来的地方。

注入之后，Activity 只声明「我需要一个 FeedRepository」。谁来 new，在模块或组合根里决定一次。测试给一个假的 Repository。这就是把创建和使用拆开。

**2. Hilt 为什么能在编译期查错**

Dagger 根据注解生成一段普通的 Java 代码，里面就是 new 和传参。某个依赖没有 `@Provides` 也没有 `@Inject` 构造，生成阶段就失败，不会等到用户点进页面。作用域也写在生成结果里：Singleton 在 Application 里留一份，ActivityRetained 能过旋转，和 ViewModel 的寿命类似。

代价是注解和组件关系要学。`@InstallIn` 装错组件，对象会活得太久或太短。例如把持有 Activity 的对象装成 Singleton，就会泄漏。

**3. Koin 为什么错误更晚**

`startKoin` 只是把定义放进一个表。`get<FeedRepository>()` 时才查表。忘了注册，编译是过的，测试没覆盖到的页面到了线上才崩。它的好处是没有注解处理器，Kotlin 写起来直接，换实现只要改 module。循环依赖和作用域仍要自己约束，运行时的灵活性不等于不用想寿命。

**4. 作用域在管什么**

不是所有东西都该 Singleton。网络客户端、仓库可以是应用级一份，才能共享连接池。跟页面状态有关的对象应该跟页面走，旋转时按需要保留，页面真正销毁时丢掉。作用域大于真实寿命，就会泄漏；小于真实寿命，就会重复创建、重复请求。

ViewModel 的注入只是「用 DI 创建 ViewModel 并传入仓库」。ViewModel 仍遵守架构那一套：不持有 View，状态用 StateFlow。DI 不代替 MVVM 或 MVI。

**5. SDK 为什么不把 Hilt 露出去**

SDK 的调用方可能没有 `@HiltAndroidApp`，可能用 Koin，也可能是 Java 手动 new。公开 API 上如果必须传入 Hilt 组件，对方为了用你的 SDK 要先接受你的 DI。正确的边界是 `init(config)` 内部自己装配。宿主如果想用 Hilt 管理别的对象，可以在自己的模块里调用这个 init，而不是 SDK 去 `@Inject` 宿主的类。

SDK 内部可以用任何方式创建对象，包括手动组合根。小 SDK 手动更清楚：看 `provideClient()` 就知道网络栈是哪一个，没有生成代码可翻。

**6. 和测试的关系**

能替换依赖，测试才不用连真服务器。Hilt 有测试模块替换绑定。Koin 可以在测试里 load 另一组 module。手动 DI 最直接：构造函数传入假对象。如果生产代码用服务定位器全局取，测试要重置全局状态，并行测试会互相污染。

注入的是依赖，不是把所有单例都放进一个全局地图就叫 DI。构造函数上能看见 `FeedRepository`，读代码的人知道这个 ViewModel 要什么。服务定位器式的 `Services.get()` 在模块内部能用，但一进页面就隐藏了依赖，重构时不容易发现谁在用网络。Hilt 的生成代码本质上仍是这些构造函数调用，只是不用手写。看生成结果想不通时，回到「谁创建、谁使用、活多久」这三句，比背注解组合有用。

测试替换时要替换到同一层。界面测试给一个假的 ViewModel 或假的状态流；仓库测试给一个假的数据源。不要在测试里启动真正的 OkHttp 还说这是单元测试。SDK 的手动组合根最容易做这件事：测试调用内部的 `create(fakeConnection)`，不必装一套 Hilt。

作用域按真实寿命选，而不是全部 Singleton。网络客户端和数据库应用级一份，才能共享连接池；页面状态跟 ViewModel 走。把 Activity 放进 Singleton 会在旋转或销毁后泄漏。SDK 公开的是 init(config)，内部组合根自己 new 连接和存储。宿主可以在自己的 Hilt 模块里调用 init，但 SDK 不能要求对方先装好某一种注入框架。漏绑在 Koin 里要靠测试把 get 走一遍，否则编译发现不了。

OkHttpClient 如果每次注入都 new，作用域就错了，连接无法复用。应是 Singleton 一份。Activity 不能进 Singleton。测试替换假的仓库，而不是真的去连服务器还叫单元测试。

手动组合根对 SDK 更干净：看 provide 函数就知道网络栈是哪一个。公开 API 不出现 Hilt 或 Koin 的类型，宿主用什么容器自己决定要不要包一层。

漏注册在 Koin 里编译期看不出来，要用测试把取用走一遍。

## 使用与实践

App 规模已经多模块、团队熟悉注解，用 Hilt，和 Jetpack 的推荐一致。想少引入生成代码、模块边界还不稳定，可以用 Koin，但要给关键路径加测试，把「忘了注册」变成测试失败而不是线上崩溃。

新代码不要为了 View 上 Hilt。ViewBinding 解决查找控件，Hilt 解决提供仓库和客户端。两件分开。

作用域按寿命选：OkHttpClient、数据库是 Singleton；页面状态是 ViewModel。不要把 Context 或 Activity 注入到 Singleton。

SDK 和中台库：公开构造或 init。文档给一个「宿主使用 Hilt 时可以这样包一层」的示例即可，不要把它写成唯一接法。内部依赖接口，测试替换实现，例如 RTC 适配层。

## 例子（至少 1 个完整代码或伪代码块 + 边界场景）

Hilt 提供仓库，ViewModel 用构造注入。界面不 new 网络：

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides @Singleton
    fun client(): OkHttpClient = sharedClient()

    @Provides @Singleton
    fun feed(client: OkHttpClient): FeedRepository = FeedRepository(client)
}

@HiltViewModel
class FeedViewModel @Inject constructor(
    private val feed: FeedRepository
) : ViewModel()
```

SDK 不出现这些注解，宿主想用 Hilt 时自己包：

```kotlin
fun initSdk(config: SdkConfig) {
    val client = buildClient(config)
    val conn = Connection(client)
    SdkRuntime.start(conn) // 手动组合根
}

@Module
@InstallIn(SingletonComponent::class)
object HostBridge {
    @Provides fun config(): SdkConfig = SdkConfig(tokenProvider())
}
```

Koin 的等价声明更短，但漏写 `single` 要到取用时才知道：

```kotlin
val appModule = module {
    single { sharedClient() }
    single { FeedRepository(get()) }
    viewModel { FeedViewModel(get()) }
}
```

边界一：把 `Activity` 注入进 Singleton 的仓库。旋转或销毁后仓库还在，Activity 泄漏。Singleton 只接受 Application Context 或无界面的依赖。

边界二：Koin 忘了注册 `FeedRepository`，编译通过，点进页面崩溃。关键页面用测试把 `get()` 走一遍，或改用编译期方案。

边界三：SDK 的 `init` 要求宿主先 `startKoin` 并安装 SDK 的 module。另一个已经用 Hilt 的宿主无法接受第二套全局容器。SDK 自己 new，宿主只传配置。

边界四：每个页面自己 `OkHttpClient()`，虽然用了注入框架，模块里却写成 `@Provides fun client() = OkHttpClient()` 没有 Singleton。每个注入点一个新池，连接无法复用。作用域要和「这个对象该有几份」一致。

## 画面（text 结构图）

```text
使用方（Activity / ViewModel）
  只声明需要 FeedRepository
        ▲
        │ 注入
组合根 / Hilt 模块 / Koin module
  OkHttpClient（Singleton，共享连接池）
  Repository
  适配层实现

Hilt：编译期生成，漏绑即失败
Koin：运行时查表，漏绑到调用才失败

SDK
  公开 init(config)
  内部自己装配
  不要求宿主安装 Hilt 或 Koin

不要
  Singleton 持有 Activity
  把 ViewBinding 当成 DI
  每个注入点 new 一个 OkHttpClient
```

## 常见坑与追问（至少 3 条）

1. **Hilt 和 Koin 怎么选？** App 且团队能接受注解，用 Hilt，漏绑在编译期暴露，也是 Jetpack 现在的推荐。想少生成代码、或要更方便地接 KMP，Koin 合适，但要用测试补上运行时才报错的缺口。SDK 两个都不强迫宿主使用。

2. **注入了就不会泄漏吗？** 不会。作用域大于对象真实寿命就会漏。把 Activity 放进 Singleton 就是例子。DI 只负责创建和传递，寿命仍要按页面、ViewModel、应用三级来想。

3. **不用框架怎么做？** 在 Application 或专门的组合根里手动 `provide`，通过构造函数往下传。测试时传假实现。小 SDK 用这种方式，公开 API 更干净。全局服务定位器能工作，但依赖不写在构造函数上，测试容易忘了重置。

4. **为什么 SDK 不直接 `@Inject` 宿主的类？** 宿主没有你的 Hilt 组件，调用就会失败。SDK 只接收普通配置对象，内部自己创建连接和存储。宿主可以在自己的 DI 里调用 `init`。

5. **ButterKnife 算 DI 吗？** 它解决的是查找 View，已经退出主流，现用 ViewBinding。不要和提供仓库、网络客户端的依赖注入放在一个答案里讲完。
