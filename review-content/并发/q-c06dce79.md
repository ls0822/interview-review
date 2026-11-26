---
id: q-c06dce79
type: qa
module: concurrent
knowledge_ref: kp-volatile-hb
title: `synchronized`、`volatile`、`ReentrantLock
priority: P0
version: 1
---

## 问题
`synchronized`、`volatile`、`ReentrantLock`

## 答案
`synchronized` 锁的是对象，不是锁一段代码的文字。两个线程进入同一个对象的同步块，第二个会堵在外面，并且堵的是线程，不是挂起协程。同一条线程可以再次进入自己已经拿到的这把锁，这叫可重入，用计数记住进了几层，出完才真的放开。它不能设置等待超时，也不能分开「等条件 A」和「等条件 B」。默认允许插队，不是按排队顺序发锁。

`ReentrantLock` 也是可重入的互斥锁。多出来的能力：`tryLock()` 拿不到就返回；`tryLock(time)` 最多等一段时间；`lockInterruptibly()` 等待时能响应中断；可以建多个 `Condition`，相当于多间等候室。`new ReentrantLock(true)` 才是公平锁，按申请顺序给，避免饿死，但吞吐量差一些。默认 `false`，新来的线程如果锁正好空着，可以插到队列前面。

`volatile` 只给单个变量做两件事：写完之后别的线程能看见；禁止把这个变量的读写和它周围的某些操作乱序到它外面。它不做「读出来、加一、写回去」这三步的互斥。`count++` 即使字段是 `volatile`，两个线程仍可能都读到 10，都写成 11。这种用 `AtomicInteger`，或者整段放进锁里。

双重检查单例为什么要 `volatile`：

```kotlin
if (instance == null) {
    synchronized(lock) {
        if (instance == null) {
            instance = Instance()   // 分配内存、构造、把引用赋给 instance
        }
    }
}
return instance
```

没有 `volatile` 时，引用赋值可以跑到构造完成之前被别的线程看见。外面那个 `if` 发现不是 null，就拿去用，对象里的字段还是默认值。加上 `volatile`，发布引用之前的构造写不会被挪到发布之后。
