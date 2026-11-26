---
id: kp-jvm-memory
type: knowledge
module: jvm
title: 运行时数据区与对象头（面试版）
priority: P0
version: 2
order: 10
---

## 一句话

堆放实例、栈放引用与帧、元空间放类结构；JMM 管跨线程可见，这张地图管对象物理落在哪——答 OOM 和答 volatile 不能混成一题。

## 组成与结构

P0 地图：五块区域 + 对象在堆上的三段式布局，关系是「线程私有栈指向共享堆，Klass 指针指回元空间里的类型元数据」。

| 区域 | 线程 | 典型内容 | 爆了是什么 |
|------|------|----------|------------|
| 程序计数器 | 私有 | 下一条字节码 | 几乎没有 OOM |
| Java 虚拟机栈 | 私有 | 栈帧：局部表、操作数栈、动态链接、返回地址 | `StackOverflowError`；线程过多则无法创建线程 |
| 本地方法栈 | 私有 | JNI / native 帧 | 同栈 |
| 堆 | 共享 | 对象、数组本体 | `Java heap space` |
| 元空间 Metaspace | 共享（本地内存） | 类结构、方法、运行时常量池（非 String 池） | 动态代理 / 反复加载类时涨 |

HotSpot 堆对象（压缩指针开启时的口述模型）：

```text
[ Mark Word 8B | Klass 4B | 实例字段... | 8B 对齐 ]
数组：Klass 后多 4B length
```

Mark Word 在同一块 64bit 里复用：hash、分代年龄、偏向锁 epoch、轻量锁指向栈上 Lock Record、重量锁指向 `ObjectMonitor`、GC 标记位。`synchronized` 的升级路径就写在这几个字上，不是另找全局锁表才算「锁在对象上」。

专家加分：TLAB（Thread-Local Allocation Buffer）让每个线程在 Eden 里先划一小条私有缓冲区，`new` 多数走 bump-the-pointer，减少分配时的同步；对象仍属于堆，只是分配路径优化。DirectByteBuffer 的堆外内存不占 Java 堆，但受 `-XX:MaxDirectMemorySize` 约束，泄漏时 heap dump 看不见那块地。

Android：ART 对象头位域与 HotSpot 不完全一致；面试先讲完 JVM 模型，再补「线上看 hprof / Profiler / meminfo，别拿 Mark Word 偏移硬解析 ART」。

## 原理

1. **引用在栈、对象在堆的设计动机。** 栈帧随调用返回弹出，生命周期与嵌套调用一致；要在 `return` 之后仍存活的数据必须逃出当前帧，于是实例进堆，靠可达性回收。大数组 `new byte[n]` 占的是堆体积，栈上只留一个引用槽。逃逸分析若证明对象不出方法，JIT 可标量替换甚至消掉堆分配——不能说成「new 一定在堆上」，但默认口述仍按堆分配讲。
2. **定位方式：直接指针 vs 句柄。** HotSpot 默认直接指针，GC 移动对象时要更新所有引用。句柄多一层间接，换址成本低但读多写多场景更贵。类型指针（Klass）让 `invokevirtual` 能找到 vtable；数组还有 length 字段参与 `ArrayIndexOutOfBounds` 检查。
3. **Mark Word 与锁语义。** 无竞争：CAS 改对象头完成轻量锁；膨胀后对象头存监视器指针，线程 park/unpark。偏向锁减少反复加同一把锁的 CAS；**撤销偏向**（批量重偏向、安全点扫描）会在某次加锁时突然变贵——面试可点到「偏向不是永久免费午餐」。hashCode 与锁互斥使用 Mark Word：无锁时可缓存在头里，一旦偏向/轻量锁占用，hash 可能迁到别处，所以「先 `hashCode` 再加锁」和反过来性能特征不同。
4. **分代年龄写在对象头。** Minor GC 幸存一次年龄 +1，到阈值（默认常见 15，JIT 会动态调 `-XX:MaxTenuringThreshold`）晋升老年代。这把「内存地图」和「GC」连成一条叙事，避免两题各背各的。
5. **元空间 vs 永久代 vs 字符串池。** Java 8 起类元数据进本地内存的 Metaspace，减轻与堆争抢；`String` 字面量池在堆上（intern 行为影响堆）。`static` 字段的引用变量在类的运行时表示里，**指向的对象仍在堆**——静态 ≠ 对象在方法区。
6. **边界与易混。** JMM 不问对象在哪块地，问 hb 与可见性。栈溢出栈顶常是同一方法无限递归；堆 OOM 常伴 `GC overhead limit exceeded` 或 shallow 业务栈。`ThreadLocal` 的值挂在 `Thread` 对象上，池化线程不 `remove` 会把值留到下一轮并制造隐性泄漏。

## 使用与实践

Android 排查顺序：哪块地在涨 → 用什么工具。Java 堆：Profiler、hprof、Dominators、到 GC Root 的路径（静态 Context、未注销监听、单例）。`pthread`/`fd` 过多不是 heap space。反复热加载插件又卸不干净会顶元数据（HotSpot 语境）；ART 更常见是 Java 堆 + Bitmap native + 线程。

不该做：在 `static` 上长期握 `Activity` / `View`；把「共享堆」说成「写入立刻全员可见」（那是 JMM）。大对象考虑复用与池化前先用 Allocation 证明是分配热点，不是先上池（池本身是强引用集合）。

## 例子

```java
public class Demo {
    static User cached;          // 引用在类元数据侧，User 实例在堆
    void foo() {
        int a = 1;               // 局部变量在栈帧
        User u = new User("Tom"); // u 在栈，实例在堆，头含 Klass
        cached = u;              // return 后仍可达
    }
}
```

错例对照：`void f(){ f(); }` → 栈溢出，与泄漏无关。`static final List<byte[]> pin` 不断 `add(new byte[1<<20])` → 堆涨，GC 后仍满，因为静态可达。错把 `int a` 说成在堆上——基本类型作局部变量只在栈帧，作实例字段才在堆内对象体。

## 画面

```text
线程栈帧 foo()
  a = 1
  u ──────┐
          v
堆: |Mark|Klass|fields...|  ──Klass──> 元空间里的类元数据
```

## 常见坑与追问

1. **永久代和元空间混为一谈。** 追问：换 Metaspace 解决什么？类元数据不再挤占堆内永久代，但仍会因类过多而涨；String 池仍在堆。
2. **局部变量都在堆。** 追问：`int` 局部变量在哪？栈帧。只有引用类型的引用槽在栈，指向堆。
3. **对象头只记「有个锁」。** 追问：无锁时 hash 存在哪？Mark Word；与偏向/轻量锁争抢同一字段。
4. **ART OOM 日志照搬 HotSpot 名词。** 追问：Android 更常见？Java 堆泄漏、Bitmap/native、线程与 fd；别只背 `-Xmx`。
5. **DirectByteBuffer 泄漏只盯 heap dump。** 追问：堆外谁管？Cleaner/虚引用收尾 + MaxDirectMemorySize；dump 里可能只有很小的 Java 包装对象。
