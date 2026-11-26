---
id: kp-equals-hashcode
type: knowledge
module: language
title: equals、hashCode 与 ==
priority: P0
version: 1
---

## 一句话

`==` 对对象比的是不是同一个引用，`equals` 比的是业务上算不算同一份值；改了 `equals` 就必须改 `hashCode`，否则 HashMap 先按哈希找桶，再 equals 也会找错地方。

## 组成与结构

| 比较 | 基本类型 | 对象 |
|------|----------|------|
| Java `==` | 比数值 | 比引用 |
| `equals` | 没有，要装箱后才有 | 默认仍比引用，可重写 |
| `hashCode` | 装箱类型有 | 默认和身份相关，重写 equals 后要一起改 |
| Kotlin `==` | 比数值 | 编译成 `equals`，空安全 |
| Kotlin `===` | — | 比引用 |

契约可以记成三条：自反、对称、传递；equals 相等则 hashCode 必须相等；hashCode 相等不要求 equals 相等（允许碰撞）。equals 涉及的字段在对象放进哈希容器期间不能变。

`String`、`data class`、`Integer.valueOf` 在缓存范围内的装箱，都会让人误以为 `==` 在比内容。把规则说死在「有没有重写、比的是哪一层」，才不会被例子带跑。

## 原理

1. **HashMap 的两步。** 用 key 的 `hashCode` 找到桶。桶里可能有链表或树，再用 `equals` 逐个比。若两个相等的 key 哈希不同，它们落在不同桶，`get` 时去了另一个桶，明明 equals 为 true 也拿不到。这就是「equals 相等但 hashCode 不同」的直接事故。
2. **默认实现。** `Object.equals` 是 `==`。`Object.hashCode` 尽量按身份区分。只重写 equals 不重写 hashCode，会违反契约：两个值相等的对象仍可能有不同的身份哈希。
3. **写对 equals。** 先判 `this`，再判 null 和类型（用 `getClass()` 还是 `instanceof` 要一致：继承体系里用 instanceof 容易破坏对称，值对象更常用 getClass 或直接做成 final / data class）。然后只比较参与业务身份的字段。数组字段用 `Arrays.equals`，不用 `==`。
4. **Kotlin 的 ==。** `a == b` 在 a 可能为空时会先判空，非空才调 `equals`，所以不会因为左边 null 就 NPE。`a === b` 才是 Java 的引用比较。data class 的 `==` 已经是值比较。
5. **String 和常量池。** `new String("x") == new String("x")` 在 Java 里是 false，`equals` 是 true。字面量 `"x" == "x"` 可能是 true，因为常量池里是同一个实例。不要用引用相等写业务。`String.intern` 可以放回池，有其成本，业务不用它当去重方案。
6. **装箱缓存。** `Integer.valueOf` 对 -128 到 127 常常返回缓存实例，`==` 可能为 true；超出范围就为 false。这是实现细节，不是语言保证你能用的数值相等。比较数值用 `equals` 或拆箱后的 `==`。

## 使用与实践

值对象用 Kotlin `data class`，让编译器生成 equals 和 hashCode，主构造全部 `val`。Java 侧用 `Objects.equals` / `Objects.hash`，或记录类型 `record`（若工具链支持）。

实体若「同一个用户 id 就是同一个人」，equals 只比较 id，不要把会变的昵称放进去，否则改昵称就从 Set 里消失。

浮点不要直接用 `equals` 比计算结果。界面坐标、金额有自己的精度规则。

给 Java 和 Kotlin 共用的模型，保证一边生成的 equals 和另一边的期望一致。平台类型上对可空字段调用 equals 前要处理 null，Kotlin data class 已经帮你做了。

## 例子

```java
final class User {
    final String id;
    User(String id) { this.id = id; }
    @Override public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        return id.equals(((User) o).id);
    }
    @Override public int hashCode() { return id.hashCode(); }
}
```

```kotlin
data class User(val id: String)
val a = User("1")
val b = User("1")
println(a == b)    // true，走 equals
println(a === b)   // false，两个实例

val s1 = String(charArrayOf('x'))
val s2 = String(charArrayOf('x'))
println(s1 == s2)  // Kotlin：true
```

Java 里 `s1 == s2` 则是 false。同一段代码换语言，`==` 的意思不同，这是混编口述里要主动说的一句。

## 画面

```text
HashMap.get(key)
  hashCode -> 哪一个桶
  桶内 equals -> 是不是这把钥匙
equals 相等而 hashCode 不同：钥匙被放进了别的桶
```

## 常见坑与追问

1. **只改 equals。** 追问：HashMap 会怎样？put 和 get 走不同桶，看起来像丢了。
2. **Kotlin 用 == 想判断是不是同一个实例。** 追问：该用什么？`===`。Java 的 == 对应 Kotlin 的 ===，不是 ==。
3. **Integer 在 127 和 128 的 == 结果不同。** 追问：能不能当语言规则用？不能，那是缓存范围。数值比较不要靠引用。
4. **data class 把可变 list 放进主构造。** 追问：equals 看不看 list 内容？看。内容变了，哈希容器同样失效。列表用 val 且不再修改，或不要当 key。
