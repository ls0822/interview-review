---
id: kp-gc-basics
type: knowledge
module: jvm
title: GC 基础与分代（面试口述）
priority: P1
version: 2
requires: [kp-jvm-memory]
order: 30
---

## 一句话

JVM 用可达性（非引用计数）判垃圾，靠「多数对象朝生暮死」做分代：新生代复制、老年代整理或并发标记；Android 面试更要会分「泄漏（永远可达）」和「分配风暴（GC 勤 + STW 卡顿）」，而不是背收集器开关。

## 组成与结构

堆的分代地图与算法代价：

```text
堆
├─ Young: Eden + Survivor(S0/S1)，一次一空一用
└─ Old: 熬过多次 Minor 或大对象直达
```

| 算法 | 适用 | 代价 |
|------|------|------|
| 标记-清除 | 老年代（CMS 收尾） | 碎片、浮动垃圾 |
| 复制 | 新生代（存活少） | 需要空闲半区，移动少 |
| 标记-整理 | 老年代 Serial/Parallel | 移动对象贵，无碎片 |

收集器点名（专家只需要能说「停顿 vs 吞吐 vs 碎片」）：Serial/Parallel 年轻代复制 + STW；CMS 并发标记但 Concurrent Mode Failure 会退化成 Full GC；G1 Region 化、可设停顿目标；ZGC/Shenandoah 超低停顿（知道定位即可）。**ART** 自有并发/压缩策略，不是把 HotSpot G1 参数搬进 Android。

GC Roots：栈局部、静态字段、JNI 全局、同步监视器、JVM 内部登记的对象等。跨代引用靠 **Remembered Set / 卡表**，Minor GC 不必每次扫整个老年代。

四种引用：强（默认）、软（内存紧时收，可做缓存）、弱（下次 GC，如 `WeakHashMap`）、虚（跟踪对象回收事件，堆外收尾）。弱引用不消除强引用链上的泄漏。

## 原理

1. **Minor GC 机制。** Eden 满 → 从 Roots + 卡表里老→幼引用出发标记存活 → 复制到空 Survivor，年龄 +1 → Eden 与旧 Survivor 清空 → S0/S1 对调。存活极少时复制成本低，这是分代的经济学基础。
2. **晋升与分配失败。** 年龄达阈值、Survivor 装不下、大对象（`-XX:PretenureSizeThreshold` 等）可能直接进 Old。晋升过快会把「本可死在 Young」的对象堆进 Old，加速 Full GC。
3. **Full GC / 重回收触发。** Old 满、元空间扩、显式 `System.gc()` 被采纳、CMS 并发阶段跟不上分配（Concurrent Mode Failure）、`GCLocker` 等。STW 窗口内业务线程在安全点停住——主线程赶上 Minor/Full 就会掉帧。
4. **可达性 vs 泄漏。** GC 只收**不可达**对象。静态集合、单例、未反注册监听、非静态内部类握外部 Activity，都仍可达。卡顿则常是**分配速率**过高（滚动里每帧上万小对象），Minor 变勤。
5. **并发标记的边界。** 并发标记期间应用仍在跑，会有浮动垃圾本轮收不掉；写屏障维护 Remembered Set。标错「Minor 扫全堆」——有卡表就只补跨代边，不是整堆标记。
6. **与 Android 的衔接。** `Allocation`/`Android Studio Profiler` 看分配栈；`LeakCanary`/hprof 看强引用链。Bitmap 像素多在 Java 堆管理时代，native 层 fd/线程仍独立爆。对象池降分配但池太大 = 强引用泄漏，须测量后局部使用。

专家对比：**引用计数**（CPython 循环引用要另行处理）JVM 不用作主方案；**手动 free**（C/C++）无自动，这里是自动但挡不住逻辑泄漏。

## 使用与实践

先判型：OOM 后 GC 仍满 → 泄漏路径；trace 里频繁 `GC_FOR_ALLOC` → 分配热点。前者砍 Root 链，后者改 `onDraw`/adapter 里的临时对象。

别用 `System.gc()` 当用户体验修复；别用弱引用包 Activity 却留 Handler 非静态内部类的强链。

## 例子

```java
static final List<byte[]> pin = new ArrayList<>();
void leak() {
    pin.add(new byte[1_000_000]); // 静态可达，任何 GC 都删不掉
}
void churn() {
    for (int i = 0; i < 10_000; i++) new byte[1024]; // 方法内短命，Minor 可收
}
```

错例：以为 `WeakReference<Activity>` 就够，同时 `Handler(Looper.getMainLooper())` 非静态内部类仍握 Activity → 强链在消息队列。对例：静态 + 匿名内部类持 Context 同样是泄漏范式。

口述分代：一万个请求 DTO 死在 Eden；误用无界 `LruCache` 强引用全晋升 → Old 满 → 长 STW。

## 画面

```text
new -> Eden
Eden 满 -> Minor（复制到 Survivor，年龄+1）
够老 / 太大 -> Old
Old 压力 -> Full / 并发失败 -> 长停顿
```

## 常见坑与追问

1. **引用计数解释 JVM。** 追问：A↔B 互相引用无外部引用，计数为何不为 0？故用可达性。
2. **Minor 扫描整堆。** 追问：老指向幼？卡表记跨代引用。
3. **WeakReference 防一切泄漏。** 追问：Handler 内部类、静态 Context 呢？强链在就不收。
4. **背 G1 参数不谈卡顿证据。** 追问：主线程卡 GC 怎么证？systrace/Perfetto 看 GC 段 + Allocation 栈。
5. **把 GC 当泄漏解药。** 追问：泄漏定义？仍可达；该改代码路径，不是调 `-Xmx`。