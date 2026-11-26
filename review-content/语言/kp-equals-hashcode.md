---
id: kp-equals-hashcode
type: knowledge
module: language
title: equals、hashCode 与 ==
priority: P0
version: 2
order: 40
requires: [kp-oop-basics, kp-string-immutability]
---

## 一句话

对象上 `==` 比是不是同一引用，`equals` 比业务身份是否相同；一旦重写 `equals` 必须配套 `hashCode`，否则 `HashMap`/`HashSet` 先按哈希找桶，再在桶里 equals 也会对不上——表现像「丢 key」。

## 组成与结构

```text
  == / ===     引用同一性
  equals       值语义（可重写）
  hashCode     桶定位（与 equals 契约绑定）
  data class   编译器生成全套
```

| 比较 | 基本类型 | 对象（Java） | Kotlin |
|------|----------|--------------|--------|
| 引用 | — | `==` | `===` |
| 值 | `==` | `equals`（默认 `==`） | `==` → equals |
| 哈希 | 装箱有 | `hashCode` | 同 JVM |

契约：自反、对称、传递；`equals` 相等 ⇒ `hashCode` 必须相等；反方向不成立（允许碰撞）。参与 `equals` 的字段在对象作哈希 key 期间不能变。

## 原理

1. **HashMap 两步查找。** `hashCode` 定桶；桶内链表/树再 `equals`。两对象 equals 但 hash 不同 → 落不同桶，`get`/`remove` 像失效。这是面试必画的失败模式。
2. **默认 `Object` 实现。** `equals` 即 `==`；`hashCode` 与身份相关。只改 equals 不改 hash → 违反契约。
3. **手写 equals 要点。** 先 `==`，再 null 与类型（`getClass` vs `instanceof` 要一致；值对象常 `getClass` 或 `final`/`data`）。只比身份字段；数组用 `Arrays.equals`。
4. **Kotlin `==` 空安全。** `a == b` 在 a 可空时不会 NPE；`===` 才是引用比较。
5. **String 与常量池迷惑。** 字面量 `==` 可能 true；`new String` 对 `new String` `==` false。业务禁止用引用相等。
6. **装箱缓存（Integer -128..127）。** `==` 可能 true 是实现细节，不能当数值相等 API。比较数值用 `equals` 或 primitives。

## 使用与实践

领域模型优先 `data class`，主构造全 `val`。Java 用 `Objects.equals`/`Objects.hash` 或 `record`。

实体「同 id 同一人」时 equals 只比 id，不要把会变昵称放进相等性。

浮点/金额不用裸 `equals` 比计算结果。跨语言模型对齐两边生成规则。

## 例子

**正确：equals + hashCode 一致**

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

**错误对照：只重写 equals**

```java
final class Bad {
    final String id;
    Bad(String id) { this.id = id; }
    @Override public boolean equals(Object o) { /* 只比 id */ return ...; }
    // 未写 hashCode → 仍用 Object.identityHashCode
}
Map<Bad, String> m = new HashMap<>();
Bad a = new Bad("1"), b = new Bad("1");
m.put(a, "v");
m.get(b); // null：equals 真但桶不同
```

```kotlin
data class User(val id: String)
println(User("1") == User("1"))  // true
println(User("1") === User("1")) // false
```

## 画面

```text
get(key)
  hashCode → 桶 index
  桶内 equals → 是不是这把 key
equals 真 + hash 不同 → 钥匙在别的桶（经典丢数据）
```

## 常见坑与追问

1. **只改 equals。** 追问：`put`/`get` 会怎样？不同桶，像丢了。
2. **Kotlin `==` 判同一实例。** 追问：用什么？`===`。
3. **Integer 127 vs 128 的 `==`。** 追问：能当语言保证吗？不能，用数值比较 API。
4. **data class 含可变 List。** 追问：改 list 后 Set 为何找不到？equals/hash 随内容变，桶错位。key 用不可变或不比 list。
5. **`instanceof` 子类对称性。** 追问：值对象为何常 `getClass`？子类字段不同仍可能 `instanceof` 通过，破坏对称。
