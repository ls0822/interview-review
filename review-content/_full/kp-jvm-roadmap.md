---
id: kp-jvm-roadmap
type: knowledge
module: jvm
title: JVM 掌握地图与复习顺序（专家）
priority: P0
version: 2
order: 1
---

## 一句话

JVM 面试要把「堆栈、类加载、GC、内存模型」连成一条因果链：类从哪来、对象在哪活、谁回收、多线程看见什么；Kotlin 只是这条链上的语法糖，不能代替字节码语义。

**P0** 讲分区、可达性、类加载双亲、GC 停顿直觉。**专家加分**是 G1/ZGC 触发、metaspace、JNI 与 Android ART 差异的边界句。

## 组成与结构

| 层 | 要回答的问题 | 主篇 | 档 |
|----|----------------|------|----|
| 运行时内存 | 堆、栈、元空间、直接内存各放什么 | `kp-jvm-memory` | P0 必会 |
| 类加载 | 双亲委派、自定义 ClassLoader 场景 | `kp-classloader` | P0 必会 |
| 垃圾回收 | 可达性、分代、Minor/Full 直觉 | `kp-gc-basics` | P0 必会 |
| JMM | hb、volatile、与 CPU 缓存 | `kp-jmm` | P0 必会 |
| Kotlin on JVM | 内联、默认参数、空检查字节码 | `kp-kotlin-jvm` | P0 必会 |

P0：

- 栈帧存局部变量与出口；堆存对象实例；方法区/元空间存类元数据。
- 双亲委派：同全限定名先让父加载，防核心类被替换。
- GC Roots：栈引用、静态、JNI、同步监视器等；不可达可被收。
- `kp-jmm` 是 `kp-thread-basics` / `kp-volatile-hb` 的先修底座。

专家加分：

- 跨代引用与记忆集；G1 的 region 与 mixed GC。
- `invokedynamic`、lambda 与 Kotlin 匿名类数量对比。

## 原理

这一节把「类从哪来、对象在哪活、谁回收、线程看见什么、Kotlin 怎么落字节码」连成因果链。

### 1. 运行时数据区分工（P0 必会）

线程私有：虚拟机栈（栈帧、局部变量）、本地方法栈、程序计数器。线程共享：堆（对象实例）、方法区/元空间（类元数据、常量池、静态变量）。直接内存（NIO）在堆外，仍受 `-XX:MaxDirectMemorySize` 约束。失败模式：把静态变量当「小缓存」长期持有 Activity Context，堆外不大但 GC Root 一直可达——这不是 GC 失能，是引用链错误。与 ART 对比：HotSpot 概念相通，实现与分代细节不同，Android 面试要一句边界。见 `kp-jvm-memory`。

### 2. 对象头、分配与逃逸（P0 必会）

对象头含 Mark Word、类指针；数组还有长度。TLAB 线程本地分配减轻同步；大对象可能直接进老年代。逃逸分析：不逃出线程或方法的对象可能被标量替换或栈上分配——**不保证**发生，别把它当性能银弹。对比 C++ RAII：JVM 靠 GC 收对象，不靠作用域析构。见 `kp-jvm-memory`、`kp-gc-basics`。

### 3. 分代 GC 与停顿（P0 必会）

分代假设：多数对象朝生夕死。Minor GC 扫年轻代，存活对象晋升；老年代满或晋升失败触发更重的收集（Full/Major 口述级）。可达性从 GC Roots（栈、静态、JNI、同步块等）出发。`System.gc()` 只是建议，泄漏是**强可达**而非「忘记 GC」。与 ZGC/G1 对比：关注停顿目标与 region，不必背参数表。OOM 分类型：堆、元空间、直接内存、栈深度各自不同异常。见 `kp-gc-basics`。

### 4. 类加载与双亲委派（P0 必会）

加载→验证→准备→解析→初始化。双亲委派：同全限定名先让父加载器尝试，防止核心类被替换（`java.lang.String` 不能被你自定义冒充）。破坏场景：SPI、Tomcat 多 WebApp、插件化热更——需要自定义 ClassLoader 并在委派规则上打洞。失败模式：ClassLoader 泄漏（Activity 被 loader 间接持有）导致类元空间涨。见 `kp-classloader`。

### 5. JMM 作为并发底座（P0 必会）

工作内存是抽象模型，真实硬件有缓存与重排。hb 规则让程序员在少数同步原语上获得可依赖次序。JVM 与语言并发章节共用这一底座：`kp-jmm` 先于 `kp-volatile-hb`。没有 hb 就不承诺可见性。

### 6. Kotlin 在 JVM 上的落点（P0 必会，细节专家加分）

`inline` 在调用点展开，消除许多 lambda 对象；`checkNotNull`/`intrinsics` 插入字节码。`when` 可编译为 tableswitch/lookupswitch 或链式比较。默认参数生成合成重载，改顺序破坏 Java 二进制兼容。空安全：可空类型在字节码层往往仍用引用 + 局部检查。对比 Java 记录类型与 Kotlin `data class`：生成物不同。见 `kp-kotlin-jvm`、`kp-language-roadmap`。

## 使用与实践

1. `kp-jvm-memory` — 画堆栈，说 OOM 哪几种。
2. `kp-classloader` — 插件化为什么破坏双亲？一句边界。
3. `kp-gc-basics` — 泄漏与 GC 的区别；静态 Context 案例。
4. `kp-jmm` — 给并发模块供 hb；与 `kp-volatile-hb` 对照读。
5. `kp-kotlin-jvm` — 同上语言篇，补字节码视角。

串讲：一次 `new ViewModel` 从类加载到堆分配，谁持有引用，配置变更后为何 Activity 泄漏跟 GC 无关跟引用链有关。

## 例子

```text
泄漏：static 持 Activity → GC Root 可达 → Full GC 也收不掉
对路：WeakReference / Application 级 / 生命周期解绑
错路：以为「调了 System.gc() 就治好泄漏」
```

## 画面

```text
jvm-memory (堆栈元空间)
    -> classloader -> gc-basics
              |
           jmm <--- 并发模块引用
              |
        kotlin-jvm (语法到字节码)
```

## 常见坑与追问

1. **把方法区等价永久代。** JDK8+ 元空间在本地内存；追问：什么 OOM 还像「类太多」？
2. **GC 等于删引用。** 追问：强可达与泄漏的定义？
3. **双亲委派绝对。** 追问：SPI / Tomcat 为什么能打破？
4. **Kotlin 没有空指针。** 追问：`!!` 和平台类型字节码？
5. **栈溢出和堆溢出混说。** 追问：递归太深报什么？