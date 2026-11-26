---
id: kp-classloader
type: knowledge
module: jvm
title: 类加载与双亲委派
priority: P0
version: 2
requires: [kp-jvm-memory]
order: 20
---

## 一句话

类要经过加载、链接、初始化才可执行；双亲委派让核心类只能由上层定义，业务 dex 里的同名 `java.lang.*` 不会替换掉真核心类——面试翻车多在「两个 ClassLoader 各加载了一份同名类」。

## 组成与结构

加载器层次（HotSpot 口述）与 Android 对照：

```text
Bootstrap（java.lang.*，Java 里 getClassLoader() 常为 null）
    ↑ parent
Platform / Ext
    ↑ parent
AppClassLoader（classpath）
    ↑ parent
自定义 ClassLoader（插件、热修、隔离）
```

**类唯一性** =（定义它的 ClassLoader，全限定名），不是字符串唯一。`instanceof`、`Class.isAssignableFrom`、泛型擦除后的强制转换都认这一对。

| HotSpot | Android（口述） |
|---------|-----------------|
| AppClassLoader | PathClassLoader（已装 APK dex） |
| 自定义 | DexClassLoader（外部路径插件） |
| Metaspace | 无同名概念，阶段仍可讲加载/链接/初始化 |

Kotlin：`object`、伴生、`companion` 的静态初始化都落在 `<clinit>`，第一次**主动使用**才跑，不是进程启动扫全库。

## 原理

1. **加载。** 按全名定位字节码（class/dex），校验魔数与结构，在方法区生成 `Klass`，堆上产生 `java.lang.Class` 镜像。此时静态字段尚未执行业务赋值。
2. **链接：验证、准备、解析。** 验证防字节码破坏 VM；准备为静态字段分配并**零初始化**（`static int x = 10` 此步是 0，`static String s = "a"` 是 null）。`static final` 编译期常量可能直接被调用方内联，甚至不触发含该字段的类初始化。解析把常量池符号引用变直接引用，可延迟到首次使用（懒解析）。
3. **初始化。** 执行 `<clinit>`：静态字段赋值 + 静态块，父类先于子类，源码顺序。JVM 保证同一类在同一加载器下只初始化一次，其他线程阻塞等待。失败则 `ExceptionInInitializerError`，**该类在该加载器内被标为错误状态**，后续 `new`/静态调用直接炸。
4. **主动使用触发初始化。** `new`、非常量静态字段读写、静态方法、`Class.forName(..., initialize=true)`、子类初始化牵出父类、含 `main` 的主类。仅通过子类访问**定义在父类**的静态字段，只初始化父类。`Class.forName` 与 `ClassLoader.loadClass(name, false)` 的差别就在是否马上进初始化——插件里常在 `false` 上控节奏，避免静态块副作用。
5. **双亲委派查找。** `loadClass`：已加载则返回；否则 `parent.loadClass`；父链一直到 Bootstrap；都失败才 `findClass`。设计目的：**类型系统是全局一致的**，防止伪造 `String` 破坏沙箱。与「继承」无关，是组合式 parent 引用。
6. **打破委派与失败模式。** SPI（`ServiceLoader`）需要「父加载器加载的接口 + 子加载器加载的实现」，靠**线程上下文类加载器**反向查找。Tomcat/Web 容器为每个 WAR 隔离类加载器，也属于「先自有再委派」的变体。搞错加载器 → `ClassCastException`（类名相同、`Class` 对象不等）。热修若让新旧 dex 各持一份 `Foo`，会出现「能编译不能强转」的幽灵 bug。

专家对比：JPMS（Java 9+ 模块）在 SE 面试可一句带过——模块边界限制非法反射访问；Android 应用不跑完整 JPMS，但 **Hidden API** 与类加载隔离是同一类「谁能看见谁」问题。

## 使用与实践

业务少手写 ClassLoader；插件 / 热修 / 脚本沙箱才动。排 `ClassNotFoundException`：dex 里有没有（R8 裁掉？）、谁在 `loadClass`、是否双份加载。`NoClassDefFoundError` 常是编译期在、运行时路径缺了，或静态初始化失败被缓存。

SDK 反射宿主类必须用宿主传入的 `ClassLoader`，不要用 SDK 自身 dex 的 loader 去载只存在于宿主的类。

不该：自定义 loader 抄 `loadClass` 成「先自己后父」却不白名单核心类；在 `<clinit>` 里起网络、注册全局监听——一次失败整类报废。

## 例子

```java
class A {
    static int x = 10;
    static { System.out.println("init A, x=" + x); }
}
class B extends A {
    static { System.out.println("init B"); }
}
// System.out.println(B.x);  // x 在 A：只初始化 A
// new B();                   // 先 A 后 B
```

错例：插件用 `DexClassLoader` 加载 `com.app.PluginActivity`，宿主用 `PathClassLoader` 也有一份 → `activity instanceof PluginActivity` 在边界处失败。正确要么全走同一 loader 命名空间，要么用接口在父 loader 定义、实现放子 loader。

委派的骨架（口述）：`loadClass(name)` → cached? → `parent.loadClass` → `findClass(name)`。只 override `findClass`，别整段替换 `loadClass` 除非明确要破委派并处理核心类。

## 画面

```text
load com.foo.Bar
  Custom → App → Platform → Bootstrap
              谁能定义，谁拥有这份 Class
准备: static int x = 0
<clinit>: x = 10，静态块
```

## 常见坑与追问

1. **准备与初始化合成一步。** 追问：`static int x = 10` 准备阶段是几？0。`static final` 编译期常量另论。
2. **双亲委派是继承。** 追问：关系是什么？parent 引用 + 委派顺序，不是 extends ClassLoader 的父类。
3. **类名相同就能强转。** 追问：怎么证明两份类？`a.getClass() == b.getClass()` 或比对 `getClassLoader()`。
4. **`<clinit>` 抛异常可重试。** 追问：同一加载器下该类永久失败，除非换新 loader 或修 dex 后重装。
5. **Kotlin object 进程启动全初始化。** 追问：何时 `<clinit>`？第一次主动使用该 object，与 Java 静态一致。