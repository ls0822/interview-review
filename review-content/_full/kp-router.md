---
id: kp-router
type: knowledge
module: architecture
title: 路由原理
priority: P0
version: 2
---

## 一句话

组件化解耦之后，调用方不能再依赖目标页面的类。路由用 path 或 URL 查一张表，找到 Activity、Fragment 或服务，中间可以插入登录、降级和埋点。表一般在编译期收集，启动时装载。

## 组成与结构

| 方案 | 特点 | 注意 |
|------|------|------|
| ARouter 一类 | 注解加 APT 收集路由表，带拦截器，应用广 | 要管混淆、表的装载耗时、项目是否还维护 |
| 官方 Navigation | 单 Activity 多 Fragment 友好，有返回栈 | 跨 module 的组件化跳转往往还要自己的路由配合 |
| 自研 | 可控，能贴业务 | 成本在表生成、拦截器、参数和监控 |
| 隐式 Intent | 系统级，不依赖具体类 | 粗，复杂参数和统一治理难 |
| DeepLink / AppLink | 外链进应用 | 最好进同一张路由表，不要另写一套分发 |

对比时用这些维度：跨 module、表装载性能、混淆、拦截器、谁在维护、学习成本、能不能路由到 Fragment 或服务而不只是 Activity。

一张路由记录通常是：path、目标类型、需要的参数、所在分组。跳转 API 是 `navigate(path, params)`。找不到 path 时走降级页，而不是崩溃。

## 原理（深度，分步骤，讲清为什么）

**1. 为什么不能继续用显式 Intent**

显式 Intent 要拿到目标 Activity 的 Class。Class 在另一个 feature 模块里，调用方就得依赖那个模块。所有业务最后都依赖所有页面，组件化的依赖方向就没了。path 是字符串或常量，常量可以放在很薄的接口模块里，调用方不知道目标类。

**2. 表从哪来**

编译期用注解处理器（APT 或 KSP）扫描 `@Route(path)`，生成「path 到目标类」的注册代码。启动时执行这些注册，把表装进内存。运行时注册也可以，但漏注册要到打开那一下才发现，编译期生成能在打包时就把路径冲突报出来。

path 冲突是两个模块注册了同一个字符串。生成阶段就应该失败，而不是运行时后注册的把前一个盖掉。分组是为了表很大时不必一次全部装载：先装公共分组，业务分组在进入该业务前再装。分组装载本身要算进启动耗时。

**3. 一次跳转走哪些步**

1. 调用方拿出 path 和参数。
2. 查表。没有这个 path：降级页或回调失败，并打点。不要静默无反应。
3. 拦截器链。登录、权限、埋点、A/B、降级开关按固定顺序过。
4. 拦截器可以改参数、换成另一个 path，或中断。异步拦截（先刷新 token 再继续）要有超时，不能把导航卡死。
5. 通过之后按目标类型启动：Activity 用 Intent，Fragment 交给 Navigation 或自己的容器，服务则返回实现而不是打开页面。
6. 参数注入给目标。目标声明需要什么，缺参数在开发期就失败。

拦截器的顺序是行为的一部分。先埋点再判断登录，和先被登录拦下来再埋点，统计结果不一样。异步拦截如果没有取消，页面已经离开了请求还回来继续跳，会打开一个用户不再想看的页面。

**4. 和 DeepLink 为什么要合成一条**

外链、推送、应用内按钮，最后都是「一个 path 加参数」。分开写三套 if-else，登录拦截和降级会漏掉其中一套。统一进路由之后，推送只负责把 path 交进来。singleTask 之类的栈策略仍由目标 Activity 和 Intent 标志决定，路由不代替任务栈。

**5. 混淆和降级**

目标类如果被混淆或裁掉，表里的类名就对不上，跳转时 ClassNotFound。要 keep 住被路由引用的页面，最好在生成表时一起生成 keep 规则。降级包括：path 没有、目标模块没装进这个包、开关把功能关掉。这三种都要有页面或回调，不能只 catch 住崩溃。

**6. 官方 Navigation 的位置**

单 Activity 里的页面栈、动画、返回，Navigation 更合适。跨业务模块时，如果仍要引用对方的 Fragment 类，依赖问题还在。常见做法是模块内部用 Navigation，模块之间用 path 路由，路由最后落到某个 NavHost 能识别的目的地。不要在面试里把两者说成只能留一个。

path 常量放在很薄的模块里，调用方依赖常量而不是依赖目标 Activity。常量字符串如果只写在调用处，改一个字母就变成静默降级，所以同一条 path 只定义一次。参数名也一样，目标页用同一个 key 取，缺了在调试构建里直接失败，发布构建再走降级，避免线上崩溃，同时让开发期立刻发现推送写错了字段。

拦截器之间不要互相 `navigate` 出环。登录拦截发现未登录，应停止当前跳转并打开登录页，登录页成功后再由登录页使用当初记下的 next path 继续，而不是登录拦截器里同步等待登录结果。等待会把点击线程或导航协程挂住。next 只保存 path 和基本参数，不保存大对象。

分组装载要算进启动耗时。首页和推送马上要用的 path 先装，其余业务进入前再装。装表失败或找不到类，多半是混淆把目标裁掉了，keep 应和生成的表一起产出。外链、推送、按钮进同一条拦截器链，登录才不会只拦到应用内跳转。path 用稳定名字而不是类名，类改名不应让已经发出去的推送失效。

异步拦截要有超时和取消。页面已经离开，刷新 token 的请求还回来继续跳，会打开用户不再想看的页。拦截器里同步做网络，点击会卡在主线程上，严重时就是 ANR。

路由只带 id 和小参数。大对象先落库，避免 Bundle 过大导致 TransactionTooLarge。找不到 path 进降级页并打点，方便发现旧包收到了新推送。

模块内部的页面栈可以用 Navigation，模块之间用 path，最后落到同一个容器，两者不是二选一。

path 冲突在生成阶段失败，不要等运行时后者覆盖前者。

## 使用与实践

path 用稳定的名字，例如 `/room/live`，不要用类名。类改名不应该让推送失效。参数只放基本类型和少量字符串。大对象先落库，路由只带 id。

登录拦截放在路由层，页面里不要每个 `onCreate` 再判断一次，否则 DeepLink 进来的那条会漏。拦截器里不要做重网络；必须请求时异步并设超时，失败有明确结果。

表按分组加载。启动只装首页和推送要立刻用的分组，其余在进入业务时装。监控两件事：启动阶段装表的耗时，以及跳转失败的 path 排行。失败排行能发现版本不兼容：新推送指向了旧包没有的 path。

自研还是用现成方案，看维护状态和你要不要服务路由、拦截器。现成方案能覆盖就不要先写框架。无论哪一种，对外都是 path、参数、拦截器、降级这四件事。

## 例子（至少 1 个完整代码或伪代码块 + 边界场景）

编译期生成的表，运行时按 path 走拦截器再启动：

```kotlin
object Router {
    private val table = mutableMapOf<String, Class<out Activity>>()
    private val interceptors = listOf(LoginInterceptor, DegradeInterceptor)

    fun register(path: String, clazz: Class<out Activity>) {
        check(path !in table) { "duplicate $path" }
        table[path] = clazz
    }

    fun navigate(context: Context, path: String, params: Bundle) {
        var target = path
        for (it in interceptors) {
            when (val r = it.intercept(target, params)) {
                is Redirect -> target = r.path
                Stop -> return
                Continue -> Unit
            }
        }
        val clazz = table[target] ?: run {
            openDegrade(context, target)
            return
        }
        context.startActivity(Intent(context, clazz).putExtras(params))
    }
}
```

登录拦截不在每个页面复制：

```kotlin
object LoginInterceptor : Interceptor {
    override fun intercept(path: String, params: Bundle): Result {
        if (pathNeedsLogin(path) && !session.isLogin()) {
            Router.navigate(app, "/login", Bundle().apply { putString("next", path) })
            return Stop
        }
        return Continue
    }
}
```

边界一：两个模块都注册 `/settings`。如果运行时后者覆盖前者，打开设置页会随机进入其中一个。注册阶段发现冲突直接失败，打包就过不了。

边界二：推送带了新版本才有的 path，旧包没有。查表失败应进降级页，告诉用户升级，而不是崩溃。降级要打点，否则你不知道有多少旧包收到了新推送。

边界三：登录拦截里同步请求用户信息。网络慢时，点击后主线程卡住，甚至 ANR。拦截器只看本地会话。刷新 token 这种必须的网络要异步，超时后停在登录页，而不是一直不返回。

边界四：混淆把目标 Activity 改名，表里仍是旧字符串。跳转 ClassNotFound。keep 规则要和表一起生成，而不是靠人记得去 proguard 文件里加。

## 画面（text 结构图）

```text
编译期
  @Route("/room/live") → APT/KSP → 生成 register 代码
  同一 path 出现两次 → 编译失败

启动
  装载公共分组 → 内存表 path → Activity / Fragment / 服务
  业务分组可按需再装

navigate("/room/live", params)
  → 查表，没有则降级页
  → 拦截器：登录 → 权限 → 埋点 → 降级开关
  → 启动目标，注入参数

外链 / 推送 / 按钮 都进同一张表
模块内页面栈仍可用 Navigation
```

## 常见坑与追问（至少 3 条）

1. **有了路由是不是就不要 Navigation？** 不是。Navigation 管单 Activity 里的页面栈和返回。路由管跨模块时不依赖目标类。模块内用 Navigation，模块之间用 path，最后可以落到同一个容器里。

2. **拦截器里能做网络吗？** 同步网络会卡主线程，点击可能 ANR。拦截器只做本地判断。必须请求时改成异步并设超时，结果只有继续、重定向或停止，不能悬着。

3. **路由表很大，启动变慢怎么办？** 分组、按需装载，并监控装表耗时。不要为了省事在 Application 里把所有业务模块的类都反射一遍。编译期生成的查找结构比运行时扫包可控。

4. **参数传一个大对象行不行？** Intent 和 Bundle 有大小限制，跨进程时会 TransactionTooLarge。路由只带 id，大对象放仓库或数据库，目标页自己取。

5. **DeepLink 为什么会绕过登录？** 因为它没走带登录拦截的那条 `navigate`，而是在某个 Activity 里单独解析 URL。外链、推送和应用内跳转要进同一张表、同一条拦截器链。
