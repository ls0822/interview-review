---
id: kp-volatile-hb
type: knowledge
module: concurrent
title: volatile、可见性与 happens-before
priority: P0
version: 2
requires: [kp-jmm, kp-thread-basics]
order: 20
---

## 一句话

`volatile` 让单次读/写对其它线程可见，并约束它与周围普通读写的重排；它不把 `i++` 变成原子。happens-before 规定「谁一定看得见谁」，不是墙上时钟的先后。

## 组成与结构

面试官说「线程安全」时，把三件事拆开：

| 维度 | 现象 | volatile |
|------|------|----------|
| 原子性 | 读-改-写被插入 | 不管复合动作 |
| 可见性 | 写留在寄存器/缓存 | 管该变量读写 |
| 有序性 | 编译器/CPU 重排 | 该变量的屏障 |

与 volatile 直接相关的 hb 规则（后文 hb = happens-before）：

- 对 volatile 写 hb 随后对同一 volatile 读。
- 监视器解锁 hb 随后对同锁加锁。
- `start` hb 子线程动作；子线程动作 hb `join` 成功返回。
- 同线程程序次序：前 hb 后（仅此线程内）。
- 传递：A hb B，B hb C → A hb C。

Kotlin `@Volatile` 编译为同一 JVM 标志，语义相同。

## 原理

**P0：没有同步时的工作内存。** 线程可把变量缓存在寄存器；JIT 可能把 `while (!flag)` 提成只读一次 flag。在无 hb 边时，JMM 允许别的线程一直看不见更新——不是「偶尔旧」，是模型允许。

**P0：volatile 写 ≈ 释放屏障。** 写前普通写不能排到写后；写刷到对后续 volatile 读可见的位置。volatile 读 ≈ 获取屏障：读后的普通读不能排到读前；并能看见此前 volatile 写及该写之前的普通写（靠传递）。「先填字段，再写 volatile 引用」= 安全发布；先写引用后填字段 = 别人见半成品。

**P0：不是互斥。** `volatile int n; n++;` 仍是三条指令，可能丢更新。计数用 `Atomic*` 或锁。

**专家加分：DCL 与重排。** `instance = new X()` 可能重排为：分配 → 引用赋值 → 构造。别线程见非 null 但字段零值。`volatile` 引用写建立 hb，堵住这条洞。静态内部类 / 枚举单例靠类初始化 hb，不必 DCL。

**失败模式（数据竞争）：** 两个线程无 hb 地读写同一非 volatile 变量，程序可表现出源码不存在的中间态，不只是「读旧」。多个 volatile 拼不变式：写 a、写 b 无互斥，读者可见新 a 旧 b——应一次 volatile 发布不可变快照。

**专家加分：64 位与 volatile long。** 32 位 JVM 上非 volatile `long` 写可能撕裂；volatile long/double 读写原子，但 `++` 仍非原子。

## 使用与实践

适合：一写多读的状态标志（`shutdown`、`ready`）、安全发布写好即不变的对象引用。

不适合：计数、`if (!flag) flag=true`、多字段不变式。多字段 → 不可变对象 + volatile 引用，或整段锁。

Android：主线程读后台写的 `volatile` 配置可以；`volatile` 的 `List` 只保护引用，列表内部仍要并发容器或锁。协程共享状态优先 `Mutex` / 单线程 Dispatcher，勿用 `@Volatile` 顶替临界区。

## 例子

```java
// 对：x 写 hb ready 写；B 见 ready==true 必见 x==42
class Holder {
    int x;
    volatile boolean ready;
    void publish() { x = 42; ready = true; }
    void consume() { if (ready) use(x); }
}
```

```java
// 错：flag 非 volatile，B 可能永远 true 循环或见寄存器旧值
class Bad {
    boolean flag;
    void run() { while (!flag) { } }
}

// 错：DCL 未 volatile instance
static Singleton instance; // 别线程见非 null 半成品
```

DCL 正写：局部变量缓存 `instance`，减少重复 volatile 读；`static volatile Singleton instance` 在双重检查内赋值。

## 画面

```text
线程 A                    主内存 / hb 边                 线程 B
x=42
volatile ready=true ----> ready 写 hb 后续 ready 读 ----> if(ready)
                                                         必见 x==42

无 volatile：B 可缓存 flag=false，与 A 无 hb
```

## 常见坑与追问

1. **volatile 做 `i++`。** 错法：多线程 `volatile` 计数。追问：为何 long 在 32 位要 volatile？防撕裂，不防 ++。
2. **以为 hb = 行号更早。** 错法：两线程普通写默认可见。追问：无同步的数据竞争最坏？可见不可能的值组合。
3. **DCL 漏 volatile 或构造逸出 `this`。** 追问：枚举单例为何安全？类初始化锁 + hb。
4. **多 volatile 拼不变式。** 错法：volatile a、b 分别改。追问：一次发布？不可变对象 + 一次 volatile 写引用。
5. **`volatile` 集合当线程安全。** 错法：发布后仍 `list.add`。追问：引用切换原子 ≠ 内部结构原子。