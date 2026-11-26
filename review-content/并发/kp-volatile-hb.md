---
id: kp-volatile-hb
type: knowledge
module: concurrent
title: volatile、可见性与 happens-before
priority: P0
version: 1
---

## 一句话

`volatile` 保证单个变量的写能被别的线程看见，并限制它和周围读写的重排序；它不把 `i++` 变成原子操作。happens-before 是 JMM 用来规定「谁一定看得到谁」的规则，不是墙上时钟的先后。

## 组成与结构

三个问题要拆开，面试官说「线程安全」时经常揉在一起：

| 问题 | 现象 | volatile 管不管 |
|------|------|-----------------|
| 原子性 | 读-改-写中间被插入 | 不管复合动作 |
| 可见性 | 写在自己缓存/寄存器里，别人一直读旧值 | 管这个变量的读写 |
| 有序性 | 编译器、CPU 换序，只要单线程结果不变 | 管这个变量的屏障 |

happens-before（后文简称 hb）是一组偏序。若 A hb B，则 A 的写对 B 可见，且 A 不会被重排到 B 之后。和 volatile 相关的核心规则：

- 对 volatile 字段的写，hb 随后对同一字段的读。
- 监视器解锁 hb 随后对同一把锁的加锁。
- 线程 `start()` hb 该线程里的任何动作；线程里的动作 hb 另一线程从 `join()` 成功返回。
- 程序次序：同一线程里，前面的动作 hb 后面的动作（单线程语义）。
- 传递性：A hb B 且 B hb C，则 A hb C。

Kotlin 的 `@Volatile` 编译成同一个 JVM 标志，规则相同。

## 原理

分四步讲清楚「为什么没有它会看不见」以及「为什么有它仍不能 `count++`」。

1. **工作内存不是第二块堆。** JMM 允许线程把变量留在寄存器或 CPU 缓存里，不必每条字节码都回写主内存。线程 B 的循环 `while (!flag)` 可能被 JIT 提成「读一次 flag，后面只看寄存器」。这不是 Java 语言故意藏数据，是在没有同步动作时，模型允许这种优化。
2. **volatile 写的效果。** 写 volatile 会插入释放屏障：这次写之前的普通写不能排到这次写之后，并且写会刷到对其他线程可见的地方。随后的 volatile 读是获取屏障：读之后的普通读不能排到这次读之前，并且能看到这之前的 volatile 写以及该写之前的普通写（靠传递）。所以「先把对象字段填好，再写 volatile 引用」是安全发布；反过来就不安全。
3. **它不是互斥。** `volatile int n; n++;` 仍是读、加、写三条动作。两个线程都读到 10，都写回 11，更新丢一次。volatile 只保证你读到的是某次完整的写，不保证读改写独占。计数用 `AtomicInteger` 或放进锁里。
4. **双重检查锁为什么必须 volatile。** `instance = new Singleton()` 在字节码层至少是：分配内存、调用构造、把引用赋给 `instance`。没有 volatile 时，后两步可以重排，别的线程在第一个 `if (instance != null)` 看到非空引用，对象里的字段还是零值。给 `instance` 加 volatile 后，构造里的写 hb 这次引用写，引用写 hb 另一线程的读，于是读到引用的线程一定看到构造完成。静态内部类单例靠类初始化锁，不必再加这层 volatile，那是另一条 hb（类初始化动作 hb 初始化之后的使用）。

`final` 字段也有安全发布：构造函数里对 final 的写 hb 构造结束，只要 `this` 没有在构造完成前逸出，其他线程看到这个引用时 final 字段已是构造时的值。这是不可变对象能少用锁的原因之一。

## 使用与实践

适合 volatile 的典型只有两类：状态标志（`shutdown`、`ready`，一写多读，写本身是原子的布尔或引用赋值），以及安全发布一个「写好之后不再改」的对象引用。

不适合：计数器、先检查再行动（`if (!flag) flag = true` 仍有竞态）、需要和多字段一起一致的不变式。多字段要么收进一个不可变对象用 volatile 一次发布，要么整段放进锁。

Android 上主线程读一个后台线程写的 `volatile` 配置是可以的；但「volatile 的 List」只保护引用本身，不保护 `ArrayList` 内部结构。发布之后还改列表，仍然数据竞争。

协程里共享可变状态优先 `Mutex` 或单线程 Dispatcher，不要以为 `@Volatile` 能替代临界区。

## 例子

```java
class Holder {
    int x;
    volatile boolean ready;
    void publish() { x = 42; ready = true; } // x 的写 hb ready 的写
    void consume() {
        if (ready) { // ready 的读，看到 true 则一定看得到 x==42
            System.out.println(x);
        }
    }
}

class Dcl {
    static volatile Dcl instance;
    static Dcl get() {
        Dcl local = instance;
        if (local == null) {
            synchronized (Dcl.class) {
                local = instance;
                if (local == null) {
                    instance = local = new Dcl();
                }
            }
        }
        return local;
    }
}
```

先把 `instance` 读进局部变量，是为了 volatile 读只发生一次，后面用局部变量，避免重复读屏障。这是写法细节，原理仍是那条 hb。

## 画面

```text
线程 A                         主内存                      线程 B
x = 42
写 volatile ready=true  ----->  x、ready 对后续读可见
                               ready==true  ------------>  if (ready)
                                                          必能读到 x==42

没有 volatile 时，B 可以一直看寄存器里的 ready=false
```

## 常见坑与追问

1. **用 volatile 做 `i++`。** 追问：64 位 `long` 的普通写在 32 位 JVM 上为什么还可能撕裂？因为一次写被拆成两次；volatile 的 long/double 读写是原子的，但 `++` 仍不是。
2. **以为 hb 等于「代码行号更早」。** 不同线程没有程序次序。只有同步动作（锁、volatile、start/join、线程初始化）把它们连起来。追问：没有同步时，数据竞争的程序在 JMM 下可以出现什么？可以出现你在源码里写不出的值。
3. **DCL 漏 volatile，或在构造里把 `this` 交给别的线程。** 逸出会让别人在 hb 建立前就拿到半成品。追问：枚举单例、静态内部类为什么常常不再写 DCL？类初始化本身有锁和 hb。
4. **多个 volatile 变量想拼出一个不变式。** 对 a 的写和对 b 的写之间没有互斥，读者可以看见新 a 旧 b。追问：怎么一次发布？把 a、b 放进不可变对象，只 volatile 写引用。
