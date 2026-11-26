---
id: kp-oop-basics
type: knowledge
module: language
title: 面向对象、重载重写与关键字
priority: P0
version: 2
order: 10
---

## 一句话

封装把变化关在类型里，继承复用实现，多态让「父类型引用」在运行时走子类重写；重载是编译期按参数表选型，重写是运行期按实际对象的方法表分派——Android 框架里二者名字相似、时机完全不同。

## 组成与结构

```text
  封装 ──字段私有，经方法出口──> 不变量只在类内破坏
  继承 ──is-a，单继承多实现──> Activity / Fragment 体系
  多态 ──引用类型 vs 实际类型──> 回调、列表里 heterogeneous 元素
  重载 overload ──编译期──> 同名不同参
  重写 override ──运行期──> 同签名换实现
```

| 概念 | 决定时机 | 看什么 | 档位 |
|------|----------|--------|------|
| 封装 | 设计时 | 字段私有，只留方法 | P0 |
| 继承 | 编译期建立父子 | 子类拥有父类成员 | P0 |
| 多态 | 运行期 | 实际对象的重写方法 | P0 |
| 重载 | 编译期 | 方法名相同，参数列表不同 | P0 |
| 重写 | 运行期 | 签名相同，子类换实现 | P0 |
| 桥方法 / 协变返回 | 编译器合成 | 泛型擦除后保住多态槽位 | 专家加分 |

Java 单继承、多实现。抽象类可带状态与构造，适合模板方法（`InputStream` 族）；接口是能力合同（`Parcelable`、`OnClickListener`），Java 8+ 可有 `default`。Kotlin 类默认 `final`，要继承必须 `open`——与 Java「默认可继承」相反，减少脆弱基类。

关键字：`final` 类/方法不可再继承/重写；`final` 变量是引用不可再指向别处，对象内容仍可变；`static` 属于类；Kotlin 用 `companion object` 表达静态入口。

## 原理

1. **重载如何在编译期定型。** 编译器只看调用点的静态类型与实参类型，按「最具体」规则选定一个目标方法，写进字节码的 `invokevirtual`/`invokestatic` 目标。运行时对象是子类也不会换另一个重载。`f(null)` 在 `f(String)` 与 `f(Integer)` 并存时可能直接编译失败，因为两个都匹配且没有更具体的赢家。
2. **重写与虚分派。** 实例方法经vtable/itable分派。子类提供相同签名（含返回类型协变）就占住槽位。字段没有多态：父引用访问的是声明类型里的字段布局；`static` 是隐藏不是重写，按引用类型静态绑定。
3. **`@Override` / Kotlin `override`。** 编译期校验你真的覆盖了父方法。少写一个参数就变成「新重载」，父实现仍被调用——`Activity` 生命周期里这种 bug 极难肉眼发现。
4. **构造链与开放方法陷阱。** 父构造先于子类字段初始化。父构造里若调用子类可重写方法，会跑进子类实现，此时子类 `lateinit`、可空字段仍是零态。因此构造期不要回调可重写虚方法（也不要在 `init` 里调 `open` 方法）。
5. **可见性与重写契约。** 重写不能缩小可见性。Kotlin `internal` 不是 Java 包私有，跨模块 Java 继承时要先想清楚 API 面。
6. **抽象类 vs 接口 vs sealed（后文细讲）。** 需要骨架+状态用抽象类；要给已有父类的组件挂能力用接口；有限分支用密封类型而不是继承树越堆越深。

## 使用与实践

SDK 回调用接口，不要强迫宿主继承你的 `BaseActivity`。固定流程（鉴权→打点→发请求）可放抽象类，把可变一步留抽象方法。

给 Java 继承的 Kotlin 类/方法标 `open`。数据模型优先 `data class` 组合字段，不用继承表达「两个字段相同」。

`final List` 引用仍可 `add`；要内容也不变需不可变实现或防御性拷贝后再交出。对外 API 文档写清「只读视图」还是「拷贝快照」。

混编：Kotlin 重写 Java 方法时注意可空、生成物上的 `bridge`；Java 调 Kotlin 默认 `final` 会编译失败，需提前 `open`。

## 例子

**正确：多态走重写，重载走编译期选型**

```java
class Animal {
    void cry() { System.out.println("..."); }
    void feed(int n) {}
}
class Dog extends Animal {
    @Override void cry() { System.out.println("汪"); }
    void feed(int n, boolean extra) {} // 重载
}
Animal a = new Dog();
a.cry();   // 汪 — 运行期分派
a.feed(1); // Animal.feed — 编译期已绑定
```

**错误对照：把重载当成重写**

```kotlin
open class Base {
    open fun onEvent(code: Int) { /* 只处理 code */ }
}
class Child : Base() {
    // 漏写 override，且多一个 String 参数 → 这是重载，不是重写
    fun onEvent(code: Int, payload: String) { }
}
// 系统仍通过 Base 引用调 onEvent(1)，永远进 Base 的实现
```

**错误对照：父类 init 调 open 方法**

```kotlin
open class Parent {
    init { describe() } // 构造期
    open fun describe() = println("parent")
}
class Child : Parent() {
  private val tag = "child"
  override fun describe() = println(tag) // 可能 NPE / 空串：tag 尚未初始化
}
```

## 画面

```text
编译期：引用类型 + 实参 → 选定重载（写死在字节码调用目标）
运行期：对象头类型 → 方法表 → 子类重写

Animal 引用 --> Dog 实例
   cry()  ---------> Dog.cry（虚方法）
   字段 x  -------> Animal.x（无多态）
```

## 常见坑与追问

1. **重载与重写说反。** 追问：`onClick(View)` 与 `onClick(View, MotionEvent)` 是哪种？重载。同签名换实现才是重写。
2. **父类构造/init 调 open 方法。** 追问：子类字段为何还是默认值？子类构造体/属性初始化尚未执行。解决：推迟到 `onCreate` 或 `init` 之后显式调用。
3. **`final` 引用等于不可变对象。** 追问：`final ArrayList` 能 add 吗？能。内容不变要靠不可变类型或只读接口+拷贝。
4. **Kotlin 类 Java 不能继承。** 追问：缺什么关键字？类与方法 `open`。与 Java 默认可继承相反。
5. **以为字段也会多态。** 追问：父引用访问 `count` 走哪份？声明类型的字段。要行为多态只用方法。
