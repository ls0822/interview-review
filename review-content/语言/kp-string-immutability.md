---
id: kp-string-immutability
type: knowledge
module: language
title: String 不可变与常量池
priority: P0
version: 2
order: 30
requires: [kp-val-var-lazy]
---

## 一句话

`String` 创建后字符序列对外不可改，「修改」一律产生新对象；字面量进常量池复用，循环拼接必须自己握 `StringBuilder`，不能用 `+` 在迭代里制造平方级垃圾与拷贝。

## 组成与结构

```text
  字符存储（JDK9+ byte[] + coder）──无公开写入口
  hash 缓存 ──内容不变才可安全缓存 hashCode
  常量池（堆内）──字面量 / intern 同内容可共享引用
  final class ──不可继承绕过
```

| 块 | 作用 | 档位 |
|----|------|------|
| 不可变体 | 安全共享、稳定哈希、可当 Map key | P0 |
| 常量池 | 字面量去重、节省堆 | P0 |
| intern | 手动入池，有全局表成本 | 专家加分 |
| Kotlin `==` | 内容相等，非引用 | P0 |

Kotlin 的 `String` 就是 `java.lang.String`；`==` 比内容，`===` 比引用——混编题里必须先声明语言。

## 原理

1. **不可变如何落地。** 构造时拷贝或接管不外泄的数组；无公开 mutator。`substring` 在面试模型里按「新字符串」记；老实现数组共享是历史细节，排障以当前 ART/OpenJDK 为准。
2. **设计动机（专家）。** 常量池安全共享；`hashCode` 可缓存；当参数/字段传递不需防御性拷贝；多线程读无锁；类名、证书路径等安全敏感串不被持有者偷偷改掉。
3. **字面量 vs `new` vs intern。** `"Tom"` 编译进常量池，同内容字面量常是同一引用。`new String("Tom")` 再在堆上分配，`==` 与字面量多为 false，`equals` true。`intern()` 把内容挂进池并返回池内引用——滥用会撑大池、增加同步，不能当业务去重。
4. **拼接机制。** 循环 `s = s + x` 每次拷贝整段前缀，代价近 O(n²)。单表达式多个 `+` 编译器可合成一个 `StringBuilder`，**不跨循环迭代**。`buildString`/`StringBuilder` 一次 `toString()`。
5. **与 JMM 发布。** 不可变对象引用安全发布后读者看到完整内容；可变 `StringBuilder` 不能当无锁共享缓冲区。
6. **长度与编码。** `length` 是 UTF-16 代码单元数；emoji 可能占两单元。协议字节用显式 `Charset`，Android 不要依赖默认 charset，日志里大串拼接别堵主线程。

## 使用与实践

日志、协议字段、循环拼 JSON 片段：`StringBuilder` / `buildString`。固定两三段插值可留给编译器。

比较内容：`equals` / Kotlin `==`。token、密码不要长期放 `String`（池、hprof 难擦）；短时敏感用 `ByteArray` 用完清零——面试点到即可。

Map key 用 `String` 合适；不要为了 key 特意 `new String`。

大文本解析：索引扫描或流式解析器，避免切出海量临时子串。

## 例子

**正确：常量池与 equals**

```java
String a = "Tom";
String b = "Tom";
String c = new String("Tom");
System.out.println(a == b);       // 常 true
System.out.println(a == c);       // false
System.out.println(a.equals(c)); // true
```

**错误对照：循环里用 `+`**

```java
String s = "";
for (int i = 0; i < 10_000; i++) {
    s = s + i + ","; // 每次拷贝整条 s
}
```

**错误对照：Java `==` 比业务字符串**

```java
String fromNet = fetch(); // 堆里新对象
if (fromNet == "OK") { }   // 几乎总 false
// 应对： "OK".equals(fromNet) 或 Objects.equals
```

```kotlin
println("Tom" == String(charArrayOf('T','o','m'))) // true
println("Tom" === String(charArrayOf('T','o','m'))) // false
```

## 画面

```text
"Tom" 字面量 ──> 常量池一份
new String("Tom") ──> 堆上另一引用，equals 仍 true
循环 s = s + x ──> 每次新 String，旧串等 GC
StringBuilder ──> 一块缓冲，最后 toString 一次变不可变
```

## 常见坑与追问

1. **网络串用 `==`。** 追问：何时 `==` 碰巧 true？同一字面量或都 intern。业务一律 equals。
2. **循环 `+` vs 一行多个 `+`。** 追问：后者为何有时没事？编译器合成一个 Builder，但迭代是多次表达式。
3. **substring「泄漏」老题。** 追问：现在怎么答？按新对象理解；真查内存用 hprof + 当前实现，不死背某一版共享数组。
4. **Kotlin/Java `==` 混答。** 追问：比引用？Kotlin `===`。
5. **主线程拼巨型日志。** 追问：瓶颈在哪？分配与拷贝，不是「String 慢」一条能概括。
