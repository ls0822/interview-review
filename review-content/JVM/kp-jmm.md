---
id: kp-jmm
type: knowledge
module: jvm
title: Java 内存模型 JMM
priority: P0
version: 2
requires: [kp-jvm-memory]
order: 40
---

## 一句话

JMM 规定多线程下哪些写对哪些读**必定可见**、哪些重排**不被允许**；它不是堆栈地图，而是用 happens-before 把原子性、可见性、有序性收成可检查的规则——没有 hb 边就没有「应该看见」的保证。

## 组成与结构

与运行时数据区对题分栏，防答串：

| | 运行时数据区 | JMM |
|--|----------------|-----|
| 问什么 | 对象、引用在哪 | 线程 B 何时能看见线程 A 的写 |
| 典型题 | OOM、栈溢出 | volatile、DCL、安全发布 |

三现象与 JMM 手段：

- **原子性**：`i++` 非单指令；`long/double` 非 volatile 写可能撕裂（64 位上仍要理解语义层复合操作）。
- **可见性**：写可能停留在寄存器/缓存，无同步时其他线程可永久读旧值（数据竞争下甚至允许怪异中间态）。
- **有序性**：编译器、CPU、缓存一致性协议在满足单线程 as-if-serial 前提下可重排。

同步动作建立 hb：`volatile` 读写、监视器 unlock→lock、`Thread.start/join`、对 `final` 字段的正确冻结、原子类中 volatile 语义的操作等。Kotlin `@Volatile`、`synchronized`、`j.u.c` 与 Java 同一模型；协程换线程不自带屏障。

## 原理

1. **as-if-serial 与数据竞争。** 单线程内可重排只要结果等价。另一线程若无 hb 与之关联去读共享可变状态，就属于数据竞争——JMM **不承诺**顺序一致性，不只「偶尔旧一点」。这是 JSR-133 修复早期 JMM 漏洞后的核心态度。
2. **happens-before 不是墙钟先后。** 墙上 A 早于 B 不代表 B 必见 A。规则链例：线程内写 x、写 y → `volatile write ready` → 他线程 `volatile read ready` 之后读 x、y，前面普通写对被挂上的读者可见（volatile 夹住语义：写侧 release，读侧 acquire）。
3. **监视器 hb。** unlock hb 后续任意线程的 lock 同一把锁。临界区内写对下一进入者可见；`synchronized` 同时给互斥 + 发布，不是「仅排队」。
4. **start / join。** `start()` 之前的父线程写 hb 子线程动作；子线程写 hb `join()` 成功返回后父线程读。子线程读父提前写好的配置不必再 volatile——边在 start 上。
5. **final 字段冻结。** 构造器中对 final 的写在正确构造完成前 hb 初次可见该对象的读者（无 this 逃逸时）。不可变对象少锁靠的是「一次引用发布带上所有 final」，不是「final 等同 volatile」。**错误构造器泄漏 this** 会破坏冻结保证。
6. **复合发布与原子类边界。** `AtomicInteger` 的 CAS/volatile 语义管**一个**变量；两个原子字段之间无天然 hb，除非用 `AtomicReference` 一次打包发布，或同锁保护。`VarHandle`（Java 9+）提供更细粒度访问模式，面试知道是 volatile/CAS 的一般化即可。

与 C++11 对比（专家一句）：Java `volatile` ≈ release/acquire 对该字段；不要声称 volatile 串行化整个程序。

## 使用与实践

共享状态选一种主风格：同锁、volatile 引用 + 不可变快照、原子变量、或单线程封闭（`HandlerThread`/单线程 Dispatcher）。队列把「消息对象填好再入队」依托队列实现的内部同步建立 hb。

禁止「sleep 一下再读」当同步。DCL 单例细节在 volatile 专篇，JMM 层要能画出「先数据后 flag/引用」的发布顺序。

## 例子

```java
class Config {
    final int n;
    final String name;
    Config(int n, String name) { this.n = n; this.name = name; }
}
class Publisher {
    volatile Config c;
    void publish() { c = new Config(1, "ok"); }
    void read() {
        Config local = c;
        if (local != null) use(local.n, local.name);
    }
}
```

错例：先 `volatile ready = true` 再写普通字段 data——读者见 ready 后读 data 可能仍是 0，因为 data 的写没有 hb 到 ready 写**之前**对读者的可见链。必须先完成 data 再发布 ready/引用。

## 画面

```text
线程 A: 写 x,y → volatile ready=1
              -------- hb -------->
线程 B:               volatile 见 ready → 读 x,y 应见 A 的写
无 volatile/锁/start 边：B 可一直不见
```

## 常见坑与追问

1. **JMM 答成堆栈图。** 追问：那叫运行时数据区；JMM 是跨线程语义。
2. **同堆即立即可见。** 追问：要什么？hb 边；缓存与重排不保证。
3. **构造器里 this 逸出给新线程。** 追问：final 还安全吗？不安全，要构造完成后再 volatile 发布。
4. **两个 volatile 互证顺序。** 追问：若无「先数据后发布」的单引用写，读者仍可能撕裂；不可变对象一次发布解决整包字段。
5. **协程「切到 Main 就安全」。** 追问：Main 上仍要不变式与封闭；换 Dispatcher 不替代 hb。
