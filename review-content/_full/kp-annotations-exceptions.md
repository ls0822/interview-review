---
id: kp-annotations-exceptions
type: knowledge
module: language
title: 注解与异常
priority: P0
version: 3
order: 100
requires: [kp-oop-basics]
---

## 一句话

注解是贴在元数据表上的标记，自己不跑逻辑——生效靠编译器、KSP/APT 或反射读它；Java 用受检异常逼调用方处理，Kotlin 不逼，但 IO/取消/可预期失败仍要在边界变成 `Result`、错误码或明确抛出。

## 组成与结构

```text
Throwable
├─ Error（一般不 catch）
└─ Exception
   ├─ RuntimeException（非受检）
   └─ 其他（Java 受检：IOException…）

注解：@Target @Retention + 参数类型限制
Kotlin 属性 → field/getter/setter 别贴错
```

| Retention | 谁还能看见 | 典型 |
|-----------|------------|------|
| SOURCE | 源码/KSP | `@Route` 生成表 |
| BINARY | class 文件 | 部分插件 |
| RUNTIME | 反射 | 运行时路由（要 keep） |

Kotlin 对 Java 要 `@Throws` 才出现在异常表。协程里 `CancellationException` 是正常取消，不是业务失败。

## 原理

1. **注解不执行。** 生效路径：编译期检查（`@Override`）、注解处理器生成代码（Room/Hilt/Moshi adapter）、运行时反射、字节码插桩。Android 偏向编译期生成，少运行时扫 dex。
2. **自定义注解空壳。** 只写 `@Route` 没有跳转；要有 KSP 生成 registry 或启动反射扫。面试要说清哪条路径。
3. **受检异常是 javac 合同。** 不改变抛出机制；Kotlin 去掉静态强制，Java 调 Kotlin 没 `@Throws` 就不必 catch——SDK 应对齐宿主语言预期。
4. **catch 粒度。** `catch (Exception)` 吃掉 `CancellationException` → 协程取消变挂起泄漏。`Error` 一般不救。空 catch 把失败变成功。
5. **try-with-resources / use。** 关闭异常与业务异常 suppressed 叠加；日志要看 suppressed。
6. **可预期 vs 编程错误。** 无网/无权限/坏参数 → `Result` 或错误码；不变量破坏 → `IllegalStateException`。toB SDK 不宜长受检链。

**Android 边界：** KSP `SOURCE` 注解进不了 APK，路由靠生成表类；`RUNTIME` 反射路由要被 R8 keep 注解与被扫描类。与序列化注解对比：`@SerializedName` 改 JSON 字段名，不自动生成跳转逻辑——面试要把「谁消费注解」说清楚。`Throws` 只影响 Java 静态检查，不改变 Kotlin 运行时抛不抛。

## 使用与实践

RUNTIME 注解给 R8 keep。`@Suppress` 压单行且理由可审。废弃 API `@Deprecated` 带 replacement。

协程 `runCatching` 也会抓取消—— rethrow `CancellationException`。

日志边界记 context，再转 UI 错误态。

## 例子

**正确**

```kotlin
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.SOURCE)
annotation class Route(val path: String)

class Reader {
    @Throws(java.io.IOException::class)
    fun read(path: String): String = java.io.File(path).readText()
}

fun load(): Result<String> = runCatching { Reader().read("a.txt") }
    .fold(onSuccess = { Result.success(it) }, onFailure = { Result.failure(it) })
```

**错误对照：以为注解=功能**

```kotlin
@Route("/home")
class HomeActivity : AppCompatActivity() // 没有 KSP/反射读者 → 啥也不发生
```

**错误对照：吞取消**

```kotlin
suspend fun work() {
    try {
        doSuspend()
    } catch (e: Exception) {
        log(e) // CancellationException 也被吃 → 父 Job 不好收尾
    }
}
```

**错误对照：Kotlin API 给 Java 无 @Throws**

```kotlin
// Java: new Api().read() 编译不要求 catch IOException
fun read(): String = Files.readString(path) // 仍可能抛，Java 侧无提示
```

## 画面

```text
注解
  SOURCE → 编译器/KSP 消费 → 生成代码
  RUNTIME → 反射 → 须 Proguard keep
异常
  可预期 → Result / 码
  编程错误 → 抛出
  取消 → 透传，不当失败
```

## 常见坑与追问

1. **写了 `@Route` 就能跳。** 追问：谁读？KSP 或反射；无读者=注释。
2. **Kotlin IO 不 catch。** 追问：给 Java？`@Throws`；对内仍要边界处理。
3. **catch Exception 吃取消。** 追问：为何要透传？取消要向上传播完成 Job 树。
4. **RELEASE 扫不到 RUNTIME 注解。** 追问：R8 裁注解/类；keep 注解与被标注类。
5. **空注解贴错属性位置。** 追问：Java 看哪个 getter？用 `@get:JvmName`/`@field:` 对准字节码。