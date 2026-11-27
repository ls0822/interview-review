---
id: kp-coroutine-builders
type: knowledge
module: coroutine
title: launch、async、withContext 与 Scope
priority: P0
version: 7
order: 40
requires: [kp-coroutine-basics, kp-coroutine-dispatchers]
---

## 一句话

`launch` / `async` / `withContext` **都会新建协程（子 Job）**：前两个默认旁路；`withContext` 新建但会等完。  
`CoroutineScope` **本身不是协程**——它带着上下文里的父 Job（常是 `SupervisorJob`）当树根；每次 `scope.launch` 才挂一条真正跑代码的子协程。

## 组成与结构

| 构建器 | 新协程？ | 和调用方 | 异常 |
|--------|----------|----------|------|
| `launch` | ✅ | 旁路，默认不等 | 默认走向父 Job |
| `async` | ✅ | 旁路，`await` 才等 | 在 Deferred 里，`await` 时抛 |
| `withContext` | ✅ 子 Job | **等块做完**再下一行 | 抛回调用方这一行 |
| `coroutineScope` | ✅ 临时普通父 | 等所有子结束；一挂连坐 | 抛给调用方 |
| `supervisorScope` | ✅ 临时监督父 | 等所有子；一挂不拆兄弟 | 子内自己处理 / CEH |
| `runBlocking` | ✅ | 堵住当前线程 | 测试/main；主线程禁用 |

| 角色 | 是不是协程 | 干什么 |
|------|------------|--------|
| `CoroutineScope` | ❌ | 盒子：持有 Context（含父 Job） |
| Scope 里的父 Job | ❌（常光杆） | 树根：生命周期、取消、连坐规则 |
| `launch`/`async`/`withContext` | ✅ | 树上的孩子，跑你的代码 |

| Android Scope | 父 Job 类型 | 何时取消 |
|---------------|-------------|----------|
| `viewModelScope` / `lifecycleScope` | **监督** `SupervisorJob` | 页面/`onCleared` |
| 自建 `CoroutineScope(Job())` | **普通** | 你 `cancel()` |
| 自建 `CoroutineScope(SupervisorJob())` | **监督** | 你 `cancel()` |

**关系一句：** 父 Job = 树根（parent↔children 引用，不是「父肚子里再跑子」）。父 `cancel` → 子都进取消；**普通父**下孩子业务失败还会连坐兄弟；**监督父**下不连坐，但未处理仍可能 CEH/崩溃。

先修：`kp-coroutine-basics`、`kp-coroutine-dispatchers`。上下文/CEH：`kp-coroutine-context`；取消：`kp-coroutine-cancel`。

## 原理

### 1. Scope / 父 Job / 子协程各是什么

**是什么：** Scope 不是协程。上下文里的 `SupervisorJob`（或 `Job`）是树根，管「停不停、谁连坐」。`launch` 时新建子协程（它自己也是 Job），`子.parent = 父Job`，父把子登记进 children——挂的是**映射/树**，不是在父 Job 内部嵌套执行。

**看代码：**

```kotlin
val parent = SupervisorJob()
val scope = CoroutineScope(parent + Dispatchers.Main)

scope.launch { /* 子 Job，parent 指向上面的 parent */ }
scope.launch { /* 另一子 Job，同一棵树 */ }

parent.cancel()  // 树根停 → 孩子们收到取消
```

**和谁有关：** Context 里 Job 元素见 `kp-coroutine-context`。

**别混：** 「取消 Scope」口语 = 取消它带的那个父 Job；Scope 对象本身没有第三条隐藏协程。

### 2. 普通父 vs 监督父（含 CEH）

**是什么：**  
- **普通父**（`Job()` / `coroutineScope`）：孩子业务异常 → 父失败 → **取消兄弟**；异常常从 `coroutineScope` 抛出。  
- **监督父**（`SupervisorJob` / `supervisorScope` / `viewModelScope`）：孩子失败 **不**拆兄弟；若该孩子没 catch，异常仍算未捕获 → **CEH** 或平台默认（Android 常崩）。

**看代码：**

```kotlin
// 页面级：监督——A 挂了 B 还能跑；A 没 catch 可能崩
viewModelScope.launch { error("A") }
viewModelScope.launch { delay(100); println("B") }

// 捆绑加载：普通——user 挂则 vip 取消，异常抛出这一行
suspend fun load() = coroutineScope {
    val user = async { api.user() }
    val vip = async { api.vip() }
    Profile(user.await(), vip.await())
}
```

**和谁有关：** 未捕获与 CEH 见 `kp-coroutine-context`、`kp-coroutine-cancel`。

**别混：** 监督 ≠ 吞异常；只是「不连坐」。`coroutineScope` **不能**靠塞 `SupervisorJob` 变监督——要用 `supervisorScope`。`launch(SupervisorJob())` 是**换父断亲**，页面取消可能管不到。

### 3. `coroutineScope` 运行流程（嵌在 launch 里）

**是什么：** 在已有协程里开临时普通父：启动子们 → **等他们结束** → 成功则继续；失败则取消兄弟并把异常抛到 `coroutineScope` 那一行。

**看代码：**

```kotlin
viewModelScope.launch {                 // L1，父=页面 SupervisorJob
    _ui.value = Loading
    try {
        val p = coroutineScope {        // S，普通父，父=L1
            val u = async { api.user() } // 父=S
            val v = async { api.vip() }  // 父=S
            Profile(u.await(), v.await())
        }
        _ui.value = Success(p)
    } catch (e: Exception) {
        _ui.value = Error(e.message)
    }
}
```

**和谁有关：** 外层监督防「整页一个 launch 失败拆掉角标 launch」；内层普通绑「用户+VIP 必须齐」。

**别混：** 两个独立 `CoroutineScope(...)` 默认**两棵树**，取消 outer 不会自动取消 inner。

### 4. `launch` 嵌套 `launch` / `async` / `withContext`

**是什么：** 三者都新建子协程并挂到当前 Job 下。嵌套只保证**父子取消关系**，不保证外层等待内层。

**看代码：**

```kotlin
viewModelScope.launch {                 // L1
    launch { delay(100); println("A") } // 旁路，L1 不等
    val d = async { api.load() }        // 旁路
    println("先往下")                   // 往往立刻执行
    val data = d.await()                // 这里才等
    withContext(Dispatchers.IO) { db() }// 新建子协程，但 L1 等完
}
```

**和谁有关：** 要「一组都完再继续」用 `coroutineScope { launch...; launch... }`。

**别混：** 父 Job `cancel` 时，挂在树上的 launch/async/withContext **都会进取消**（还需协作点才停干净；`launch(Job())` 断亲则取消不到）。

### 5. `async` 的异常何时冒出来

**是什么：** 异常先进 `Deferred`。不 `await` 这一行暂时不抛。但父若是普通 `coroutineScope`，孩子一失败父就失败，**兄弟照样被取消**——不必等 `await`。

**看代码：**

```kotlin
coroutineScope {
    val a = async { riskyA() }
    val b = async { riskyB() } // a 挂 → b 被取消
    a.await() to b.await()
}
```

**和谁有关：** `async` 的 CEH 基本不响，见 `kp-coroutine-context`。

**别混：** 「不 await 就没异常」只在**监督**结构下部分成立；失败的那条 async 自己仍结束了。

### 6. `coroutineScope` 与 `supervisorScope`

**是什么：** 两者都会**等**子协程结束才返回。差别：普通 scope 一个孩子失败 → 取消兄弟并向上抛；监督 scope 孩子失败 → 兄弟继续，异常要在子内接住或 CEH。

**看代码：**

```kotlin
suspend fun strict() = coroutineScope {
    async { feed() }
    async { inbox() }  // 一边挂，另一边停
}

suspend fun loose() = supervisorScope {
    launch { runCatching { feed() } }
    launch { runCatching { inbox() } }
}
```

**和谁有关：** `launch(SupervisorJob())` 当参数是**换父**，不是 `supervisorScope`；见 `kp-coroutine-context`。

**别混：** 只换 `supervisorScope` 却不 `await`/catch，异常仍可能未捕获。

### 7. `withContext`：子协程，但会等完（不是旁路兄弟）

**是什么：** 实现上会建**子 Job**（可取消、可换 Dispatcher），但调用方**挂起等待**块结束才继续。观感像「同一条业务逻辑换工人」；和 `launch` 那种「丢出去自己先往下走」相反。

**看代码：**

```kotlin
scope.launch {
    val page = withContext(Dispatchers.IO) { api.page() }
    render(page)   // 一定在 page 之后；不是并行
}

scope.launch {
    launch(Dispatchers.IO) { api.page() }
    render(???)   // 错：这里还没有结果
}
```

**和谁有关：** 调度切换见 `kp-coroutine-dispatchers`；挂起的是外层协程见 `kp-coroutine-basics`。

**别混：** 「有子 Job」≠「和 launch 一样并行」。并行要显式 `async`/`launch` 多个，再决定等不等。

### 8. `GlobalScope` 没有主人

**是什么：** 不跟界面、不跟 ViewModel。页面关了回调仍可能回来改已销毁 View，或泄漏加载器。业务禁止。

**看代码：**

```kotlin
// 错
GlobalScope.launch { loadAndUpdateUi() }

// 对
viewModelScope.launch { ... }
// 或 SDK 自有 Scope，在 close() cancel
```

**和谁有关：** 离开页面仍要完成的上传 → 业务 Scope 或 WorkManager，不要 `viewModelScope`。

**别混：** `GlobalScope` 不是「应用级后台」；没有结构化取消。

## 使用与实践

### 并行两接口：先定要不要互拆

**是什么：** 一个失败整页失败 → `coroutineScope` + `async` + `await`。两块 UI 互不影响 → `supervisorScope` + 各自 `runCatching`。串行依赖 → 链式 `withContext`。耗时 ≈ 串行相加 / 并行取较慢那次。

**看代码：**

```kotlin
// 串行：总时间 ≈ t1 + t2（OkHttp execute 阻塞也行，关进 IO）
suspend fun loadSerial() = withContext(Dispatchers.IO) {
    val user = client.newCall(userReq).execute().use { parseUser(it) }
    val vip = client.newCall(vipReq).execute().use { parseVip(it) }
    Profile(user, vip)
}

// 并行：总时间 ≈ max(t1, t2)
suspend fun loadParallel() = coroutineScope {
    val user = async(Dispatchers.IO) {
        client.newCall(userReq).execute().use { parseUser(it) }
    }
    val vip = async(Dispatchers.IO) {
        client.newCall(vipReq).execute().use { parseVip(it) }
    }
    Profile(user.await(), vip.await())
}
```

**和谁有关：** 回调式 OkHttp 用 `suspendCancellableCoroutine`，见 `kp-callback-to-suspend`。纯计算 `suspend` 不会自动并行，见 `kp-coroutine-basics`。

**别混：** 两个 `async` 裸挂在 `viewModelScope` 不 `await`——异常躺在 Deferred，还可能无人处理。`suspend` 本身不决定串行还是并行，写法才决定。

### `runBlocking` 只作测试桥

**是什么：** 把挂起世界接回阻塞线程。Android 主线程、Binder、持锁线程里用它会和调度/锁形成环。

**看代码：**

```kotlin
@Test
fun testRepo() = runBlocking {
    assertEquals(1, repo.load())
}
```

**和谁有关：** 生产代码用 `lifecycleScope`/`viewModelScope`，不用 `runBlocking` 包 UI。

**别混：** `runBlocking` 子异常会抛到被堵住的线程，不是 CEH 弹 Toast 那条路。

## 例子

`Session`：`SupervisorJob` + `Main`，`refresh()` 里 `withContext(IO)` 取页再 `render`；`refreshParallel()` 里 `supervisorScope` 两块各管错误；`close()` 里 `job.cancel()`。

**错：** `launch(IO) { load() }` 下一行当结果已就绪。  
**对：** `withContext(IO) { load() }` 或 `async { }.await()`。

## 画面

```text
CoroutineScope（盒子，不是协程）
  └─ 父 Job 树根（常 SupervisorJob，光杆）
        │  parent ↔ children 引用
        ├── launch / async / withContext 子协程（跑代码）
        └── …

嵌套常用形态：
viewModelScope（监督树根）
  └─ launch L1
       └─ coroutineScope S（普通父，会等待）
            ├── async a
            └── async b   ← a 挂则 b 取消，异常抛出 S

父 cancel → 树上子全部进取消（协作点才停干净）
```

## 常见坑与追问

1. **`launch(IO)` 下一行就用结果。** 追问：和 `withContext`？launch 旁路，withContext 做完才继续。
2. **两个 async 在 viewModelScope 不 await。** 追问：异常去哪？Deferred；还可能未捕获。
3. **上传放 viewModelScope。** 追问：退出页面？`onCleared` 取消上传。改业务 Scope/WorkManager。
4. **自建 Scope 用普通 Job，一请求失败全停。** 追问：viewModelScope 为何不是？`SupervisorJob`。
5. **以为 Scope 本身是一条协程。** 不是；树根 Job 常光杆，`launch` 才开跑代码的子协程。
6. **以为挂到父 Job = 在父内部嵌套执行。** 是 parent/children 树，子自己在 Dispatcher 上跑。
7. **`coroutineScope` 加 SupervisorJob 就变监督？** 不会；监督用 `supervisorScope`。`launch(SupervisorJob())` 是换父断亲。
8. **`withContext` / `launch` / `async` 谁开协程？** 三个都开；差别是等不等。
9. **多接口写了 suspend 就会并行？** 不会；并行要 `async`。
