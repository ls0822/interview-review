---
id: kp-annotations-exceptions
type: knowledge
module: language
title: 注解与异常
priority: P0
version: 1
---

## 一句话

注解是给编译器、处理器和反射看的元数据，自己不执行逻辑；Java 用受检异常强迫调用方处理，Kotlin 不强迫，但失败仍然要在边界变成错误码、Result 或明确的抛出。

## 组成与结构

异常层次：

```text
Throwable
├─ Error                 虚拟机级，一般不 catch（OOM、StackOverflow）
└─ Exception
   ├─ RuntimeException   非受检：NPE、IllegalArgument、IllegalState
   └─ 其他               受检：IOException 等，Java 必须处理或声明
```

Kotlin 所有异常都按非受检处理。给 Java 用的方法加上 `@Throws(IOException::class)` 才会出现在字节码的异常表里，javac 才强制 catch。

注解三件套：`@Target` 能贴在哪，`@Retention` 留到什么时候，注解类本身的参数。

| Retention | 何时还在 | 典型 |
|-----------|----------|------|
| SOURCE | 只在源码 | `@Suppress`、部分提示 |
| BINARY / CLASS | 进 class，运行时反射不一定读到 | 部分编译器插件 |
| RUNTIME | 反射能读 | 运行时路由、少数 DI |

参数类型有限制：基本类型、String、Class、枚举、其他注解、它们的数组。不能随便放一个自定义对象。

Kotlin 要用 `@get:` `@set:` `@field:` `@param:` 指定注解到底贴在属性的哪一段字节码上，因为一个属性会拆成字段和访问器。空注解贴错位置，Java/Kotlin 互操作就看不见。

## 原理

1. **注解为什么不执行。** 它只是 class 上的一张表。真正做事的是读这张表的程序：编译器（`@Override` 检查签名）、注解处理器在编译期生成新源码（KSP/APT：Room、Hilt、ARouter）、运行时反射扫描、或字节码工具改写。Android 上更偏向编译期生成，因为反射慢、还要 keep，混淆一开就容易丢。
2. **自定义注解的生效路径。** 只声明 `annotation class Route(val path: String)` 不会有路由。要么 KSP 在编译期扫到它生成注册表，要么启动时反射扫 dex。面试要说出你用的是哪一条，不要说「注解实现了跳转」。
3. **受检异常的编译器合同。** Java 方法签名上的 throws 是调用方合同的一部分。它不改变运行时抛出的机制：任何异常都能抛，受检只是编译器多检查了一层。Kotlin 拿掉这层检查，调用 Java 的 IO 方法可以不写 try，异常仍会把协程或线程打穿。
4. **捕获的粒度。** `catch (Exception)` 会把 `CancellationException` 一起吃掉，因为取消异常是 `Exception` 的子类在协程里被当作正常停止信号。协程里要先把取消异常抛回去。`Error` 一般不要 catch，OOM 之后继续跑往往更糟。空 catch 等于把失败变成成功。
5. **资源关闭。** Java `try (InputStream in = ...)` 在结束时调用 close，包括异常路径。Kotlin 用 `inputStream.use { }`，同一思想。关闭本身抛异常时，会和业务异常叠加，JDK 用 suppressed 挂在主异常上，排查时要看 cause 和 suppressed，不要只看第一行。
6. **和错误码的取舍。** SDK 对宿主不宜用一长串受检异常当主 API。异常会把控制流拆碎，Java/Kotlin 两边的强制程度还不一致。可预期失败（无网络、无权限、参数错）用 `Result` 或错误码；编程错误（不变量被破坏）才抛 `IllegalStateException`。

## 使用与实践

自定义标记优先 SOURCE 或让 KSP 消费。确实要运行时读，Retention 用 RUNTIME，并给 R8 写 keep，否则注解和目标类可能被裁掉，反射扫到空列表。

日志不要吞异常。至少在边界记一条带上下文的日志，再转换成对用户的错误态。可恢复的失败不要打成 crash。

`@Suppress("UNCHECKED_CAST")` 只能压在已经手工保证过的那一行，不要压整个文件。`@Deprecated` 要带替换建议和级别，SDK 公开方法废弃后保留一段时间。

协程里 `runCatching` 也会抓住取消异常，用的时候要把它重新抛出，否则取消会被当成普通失败。

## 例子

```kotlin
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.SOURCE)
annotation class Route(val path: String)

class Reader {
    @Throws(java.io.IOException::class)
    fun read(path: String): String = java.io.File(path).readText()
}

fun load(): Result<String> = try {
    Result.success(Reader().read("a.txt"))
} catch (e: java.io.IOException) {
    Result.failure(e)
}

fun readFile(path: String): String =
    java.io.File(path).inputStream().use { it.reader().readText() }
```

Room 的 `@Dao`、Hilt 的 `@Inject` 属于编译期被处理器读走并生成实现的那一类。运行时你调用的是生成类，不是注解本身。

## 画面

```text
注解贴在源码上
  SOURCE  -> 编译器 / KSP 读完即丢，生成新代码
  RUNTIME -> 反射去读，要 keep
异常
  可预期失败 -> Result / 错误码
  编程错误   -> 抛出去
  取消       -> 不要当普通 Exception 吃掉
```

## 常见坑与追问

1. **以为写了注解就有路由。** 追问：谁在读它？KSP 生成表，或运行时反射。没有读者就只是注释。
2. **Kotlin 不强制受检，于是 IO 失败没人管。** 追问：给 Java 调用要加什么？`@Throws`。对内呢？仍要 catch 或放进 Result。
3. **catch (Exception) 把协程取消吃掉。** 追问：为什么取消是异常？用来在挂起点展开栈并走 finally。必须先抛回 `CancellationException`。
4. **RUNTIME 注解在 release 扫不到。** 追问：R8 做了什么？裁掉了没被引用的注解。keep 注解和被标的类。
