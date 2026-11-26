---
id: kp-string-immutability
type: knowledge
module: language
title: String 不可变与常量池（面试版）
priority: P0
version: 1
---

## 一句话

`String` 一旦创建，里面的字符就不能改；看起来像修改的操作都会产生新对象。字面量进常量池以便复用，频繁拼接要用 `StringBuilder`，不要在循环里用 `+` 制造一串中间字符串。

## 组成与结构

面试版只抓三块，不把整个 `String` 源码背下来：

| 块 | 作用 |
|----|------|
| 字符存储 | JDK 9 起多为 `byte[]` 加编码标记，更早是 `char[]`。外部不能拿到可写数组 |
| `hash` 缓存 | 第一次 `hashCode` 算完可以留下，因为内容不会变 |
| 字符串常量池 | 字面量和 `intern()` 的结果放在堆里的池中，相同字面量可以是同一实例 |

`final class String` 本身不能被继承，字段也没有对外部的写入口。所以不存在「子类把 set 打开」这种绕法。

Kotlin 的 `String` 就是 `java.lang.String`。`==` 在 Kotlin 里比较内容，在 Java 里比较引用，这是语言差异，不是两套字符串实现。

## 原理

1. **不可变如何保证。** 构造时把传入的数组拷贝进内部存储（或接收已经不外泄的数组），之后没有任何公开方法改这个存储。`substring` 在老版本可能共享数组，现在的面试模型按「返回新字符串」来记即可。反射硬改私有字段不算语言契约，破坏的是你自己。
2. **为什么要不可变。** 可以安全放进常量池共享，多个引用指向同一份不会被别人改掉。哈希可以缓存，当 HashMap 的 key 才稳定。当作参数传来传去不必防御性拷贝。多线程读同一字符串不需要锁。类加载器和安全敏感 API 也依赖「类名、路径不会在你手里被改掉」。
3. **常量池和 new 的差别。** 源码里的 `"Tom"` 在编译期放进常量池，运行时相同内容的字面量通常是同一个引用。`new String("Tom")` 会再在堆上分配一个对象，内容和池里那份相同，但是另一个实例。Java 的 `==` 因此是 false，`equals` 是 true。`intern()` 把当前内容放进池并返回池里的引用，大量随意 intern 会把池撑大，不要当业务去重。
4. **拼接实际发生了什么。** 循环里 `s = s + item` 每次都拷贝已经拼好的前缀，总代价接近平方。编译器对同一次表达式里的几个 `+` 会收成一个 `StringBuilder`，这只限于一条表达式，不跨循环迭代。循环里应自己 `append`，最后 `toString()` 一次。
5. **和不可变对象发布的关系。** 字符串引用一旦安全交给别的线程，对方看到的内容就是完整的，因为没有「改了一半的字符」。这和 JMM 里 final 字段的安全发布是同一类理由。可变的 `StringBuilder` 不能这样共享。
6. **编码和长度。** `length` 是 UTF-16 代码单元数，不是「用户看到的字数」，也不是字节数。emoji 可能占两个 `char`。网络协议要的是字节时用明确的 `charset` 去 `toByteArray`，不要假设一个字符一个字节。Android 默认字符集不要依赖平台默认，写死 UTF-8。

## 使用与实践

日志、协议拼接、循环组装 JSON 片段，用 `StringBuilder` 或 Kotlin 的 `buildString`。少量固定段的 `"a=$a,b=$b"` 可以留给编译器。

比较内容用 `equals` 或 Kotlin 的 `==`。密码、token 不要长期留在字符串里：字符串进池、进 hprof、不能主动擦掉。敏感短时数据用字节数组，用完填充 0。面试点到即可，不必展开密码学。

`String` 做 Map 的 key 很合适，因为不可变且哈希稳定。不要 `new String` 只为了当 key。

大文本不要在主线程上反复 `substring` 和拼接。解析协议优先用索引扫描或现成解析器，而不是切出几百个临时字符串。

## 例子

```java
String a = "Tom";
String b = "Tom";
String c = new String("Tom");
System.out.println(a == b);          // 通常 true，同一字面量
System.out.println(a == c);          // false
System.out.println(a.equals(c));     // true

StringBuilder sb = new StringBuilder();
for (int i = 0; i < 1000; i++) sb.append(i).append(',');
String all = sb.toString();
```

```kotlin
val text = buildString {
    append("room=")
    append(roomId)
}
println("Tom" == String(charArrayOf('T', 'o', 'm'))) // true，比的是内容
```

Java 里后一种写法要用 `equals`。把这段差异说出来，面试官就知道你没有把两种 `==` 记混。

## 画面

```text
字面量 "Tom" ----> 常量池中的一个 String
new String("Tom") -> 堆上另一个 String，内容相同
s = s + "x" 每次：拷贝旧字符 + 新字符 -> 新对象，旧的等 GC
StringBuilder：一块可变缓冲，最后 toString 才变成不可变 String
```

## 常见坑与追问

1. **用 Java 的 == 比网络返回的字符串。** 追问：什么时候 == 会碰巧为 true？两边都是同一字面量或 intern 过。业务一律 equals。
2. **循环里用 + 拼接日志。** 追问：为什么一条表达式里的 + 又没事？编译器会合成一个 StringBuilder，循环的每次迭代是分开的表达式。
3. **以为 substring 一定共享原数组造成泄漏。** 追问：现在怎么答？按不可变新字符串理解；真要查内存以当前 JDK/Android 的实现和 hprof 为准，不要死背某一版的共享数组。
4. **Kotlin 的 == 和 Java 的 == 混用在同一题。** 追问：Kotlin 比引用用什么？`===`。字符串内容相等在 Kotlin 用 `==` 就会走到 equals。
