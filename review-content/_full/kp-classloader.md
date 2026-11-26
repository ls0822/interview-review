---
id: kp-classloader
type: knowledge
module: jvm
title: 类加载与双亲委派
priority: P0
version: 1
---

## 一句话

类要经过加载、链接、初始化才可用；双亲委派是「先交给父加载器」，用来保证核心类不被业务 classpath 里的同名类换掉。

## 组成与结构

加载器是「谁有权把字节变成类」的命名空间。Java SE 上常见层次：

```text
Bootstrap（启动，加载 java.lang.*，Java 里常显示 null）
    ← 父
Platform / 扩展加载器
    ← 父
AppClassLoader（应用 classpath）
    ← 父
自定义 ClassLoader（插件、热修）
```

同一个全限定名，被不同加载器定义，就是两个类，`instanceof` 和强制转换都会失败。所以「类唯一」指的是（加载器，全名）唯一，不是字符串唯一。

Android 上对应关系不要背成 HotSpot：`BootClassLoader` 加载框架，`PathClassLoader` 加载已安装 APK 的 dex，`DexClassLoader` 常见于从外部路径加载插件 dex。ART 没有 Metaspace 这个 HotSpot 名词，但「类先被定义，再在主动使用时初始化」这套阶段仍然可以按 JVM 面试模型讲，最后补一句运行时是 ART。

## 原理

1. **加载。** 按全名找到 class 或 dex，读入字节，校验基本格式，在方法区生成类的运行时表示，并在堆上得到一个 `Class` 对象作为入口。此时静态变量还没跑业务赋值。
2. **链接，分三小步。** 验证：字节码是否合法，会不会破坏虚拟机。准备：给静态变量分配内存并置零值，`static int x = 10` 在这一步是 0，`static String s = "a"` 是 null，`static final int C = 10` 若是编译期常量，常常已经写进调用方的常量池，连初始化都可能不触发。解析：把常量池里的符号引用（类名、方法名）换成直接地址，可以发生在链接期，也可以推迟到第一次使用。
3. **初始化。** 执行 `<clinit>`，也就是静态赋值和静态块，按源码顺序，且父类先于子类。JVM 保证同一类的初始化在多线程下只发生一次，其他线程会等待。这一步才把 x 从 0 改成 10。
4. **什么叫主动使用。** `new`、调用静态方法、读写非常量静态字段、反射、子类初始化引起父类初始化、主类启动。通过子类名去读父类的静态字段，只会初始化父类。`Class.forName` 默认初始化；Android 插件场景有时要控制是否初始化，避免一加载就跑静态块。
5. **双亲委派的查找顺序。** 自定义加载器收到 `com.foo.Bar`，不先自己读文件，而是调用父加载器的 `loadClass`。父再问祖父。启动加载器能加载的核心类由它定义。都加载不了，才回到发起者自己 `findClass`。好处：你在应用里放一个假的 `java.lang.String` 也轮不到你来定义；同一个名字不会被 AppClassLoader 再定义一遍。
6. **打破委派。** 父加载器加载的类里要调用子加载器才能看见的实现（SPI、部分容器）时，会用线程上下文类加载器反向去找。热修、插件常常自己先加载插件 dex，再把系统类委托回去，否则插件类和宿主类会互相看不见或重复。面试态度：可以说「有隔离需求才会破」，同时说清风险——搞错加载器就会出现 `ClassCastException`，两个看起来同名的类不能互相赋值。

Kotlin `object` 的初始化也走 `<clinit>`，第一次主动使用才执行 `init` 块，不是进程一启动就把所有 object 初始化完。

## 使用与实践

业务代码不要手写 ClassLoader，除非在做插件或要隔离的脚本。排查 `ClassNotFoundException` 时先问三件事：dex 里有没有这个类（R8 是否裁掉）、是哪个 ClassLoader 在找、是不是两个加载器各加载了一份。

`NoClassDefFoundError` 多半是编译期还在、运行时类路径丢了或静态初始化失败被缓存成错误。`ExceptionInInitializerError` 就是 `<clinit>` 里抛了异常，随后对这个类的使用都会失败。

SDK 若用反射加载宿主类，要使用宿主传入的 `context.classLoader`，不要用 SDK 自己 dex 的加载器去载一个只存在于宿主的类。

## 例子

```java
class A {
    static int x = 10;
    static { System.out.println("init A, x=" + x); }
}
class B extends A {
    static { System.out.println("init B"); }
}
// 读 B.x 若 x 定义在 A：只初始化 A，不初始化 B
// new B()：先 A 后 B
```

委派的伪代码就是 `ClassLoader.loadClass` 的骨架：已加载则返回；有父则 `parent.loadClass`；父失败再 `findClass`。自定义加载器只重写 `findClass`，不要把 `loadClass` 整个抄成「先自己后父亲」，除非有意打破委派并处理核心类白名单。

## 画面

```text
要加载 com.foo.Bar
  自定义 --问--> App --问--> Platform --问--> Bootstrap
                                  | 不能
                                  v
                            自顶向下，谁能定义谁定义
准备阶段：static int x = 0
初始化：  static int x = 10，静态块跑完
```

## 常见坑与追问

1. **把准备和初始化说成一步。** 追问：`static int x = 10` 在准备阶段是几？是 0。只有编译期常量 `static final` 才可能不走这段。
2. **认为双亲委派是继承。** 加载器之间是 parent 引用，不是 extends。追问：为什么核心类在 Java 里 `getClassLoader()` 常为 null？启动加载器由本地代码实现，没有 Java 对象。
3. **插件里 ClassCastException，类名却相同。** 追问：怎么证明确实是两个类？打印两边的 `getClassLoader()`，或看 `==` 比较两个 `Class` 对象。
4. **静态块里启动线程或注册监听。** 初始化失败会被缓存，这个类在该加载器里再也起不来，除非换加载器。追问：和 Kotlin `object` 的关系？第一次访问触发 `init`，抛异常则同样初始化失败。
