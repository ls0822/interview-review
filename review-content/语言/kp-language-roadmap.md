---
id: kp-language-roadmap
type: knowledge
module: language
title: 语言掌握地图与复习顺序（专家）
priority: P0
version: 2
order: 1
---

## 一句话

Kotlin/Java 语言面试不是背语法表：先讲清「编译期分派 vs 运行期分派、引用与相等」，再沿空安全与集合走到泛型擦除，最后用扩展函数与互操作把 Android 存量 Java 接上。

下面用两档标注。**P0 必会**是资深岗开口就要讲对的边界。**专家加分**是追问 why、对比 JVM 语义时拉开差距的机制，不要当开场白，但要能下钻。

## 组成与结构

按层记，每层只回答一个问题，下一层默认上一层已能口述。

| 层 | 要回答的问题 | 主篇 | 档 |
|----|----------------|------|----|
| 类型与分派 | 封装继承多态；重载与重写各发生在哪一阶段 | `kp-oop-basics` | P0 必会 |
| 引用与延迟 | `val`/`var`、`lazy` 与初始化顺序 | `kp-val-var-lazy` | P0 必会 |
| 字符串语义 | 不可变、`intern`、与 `==` 的关系 | `kp-string-immutability` | P0 必会 |
| 相等契约 | `equals`/`hashCode` 与容器行为 | `kp-equals-hashcode` | P0 必会 |
| 空安全 | 平台类型、`!!`、与 NPE 边界 | `kp-null-safety` | P0 必会 |
| 代数类型 | `data`/`sealed` 与 when 穷尽 | `kp-data-sealed` | P0 必会 |
| 集合 | 只读/可变、结构共享、迭代失效 | `kp-collections` | P0 必会 |
| 泛型 | 型变、擦除、处型化与 `reified` | `kp-generics` | P0 必会 |
| 扩展与高阶 | 扩展不是子类；SAM 与内联 | `kp-extensions-hof` | P0 必会 |
| 注解与异常 | 声明处/使用处、检查异常与 Result | `kp-annotations-exceptions` | P0 必会 |
| Java 互操作 | `@Jvm*`、默认可见性、集合映射 | `kp-java-kotlin-interop` | P0 必会 |

P0 必会，要能落到 Android 代码上：

- 分派：重载看静态类型，重写看运行期 `invokevirtual` 的实际类型；`List` 里装 `ArrayList` 调的是接口里声明的那张表。
- 相等：`==` 在 Kotlin 是结构相等；`HashMap`/`HashSet` 破坏 `equals`/`hashCode` 契约会「丢键」。
- 空安全：`?.` 链断则整链为 null；把平台类型当已空检是混合模块的第一杀手。
- 泛型：`List<*>` 与 `List<Any?>` 不是一回事；运行时擦除，反射和 `reified` 是两条补救路。
- 互操作：Kotlin `internal` 对 Java 仍是 public；默认参数生成 overload，改签名是二进制破坏。

专家加分：

- `lazy` 默认线程安全模式与 `LazyThreadSafetyMode` 对启动路径的影响。
- `data class` 的 `copy` 只做浅拷贝；嵌套可变仍要不可变或深拷贝策略。
- 内联高阶：非 `inline` 则 SAM 装箱；`crossinline`/`noinline` 各限制什么。
- Java 泛型桥方法与 Kotlin 平台类型在字节码层的名字 mangling。

## 原理

这一节是深层原理必掌握清单。复习时每条都要能脱离文章，用自己的例子讲完。

### 1. 编译期 vs 运行期分派（P0 必会）

重载（overload）在编译期根据**静态声明类型**和参数表选中一个字节码符号，调用点一旦编译完成就不再改选。重写（override）走虚方法表：`invokevirtual` 在运行期查对象实际类的vtable，父类型引用只能约束「能点到的名字」，不能约束「跑哪份实现」。失败模式：在 Java 里对子类实例用父类引用调用，子类新增的**重载**方法不会被父类签名匹配——你以为多态了，其实编译期就绑定了父类可见签名。与 C# `virtual`/`override` 对比：JVM 默认实例方法除 `final` 外皆可表分派。见 `kp-oop-basics`。

### 2. 引用、相等与哈希契约（P0 必会）

`equals` 为真则 `hashCode` 必须相同；逆命题不成立，所以桶碰撞是正常现象。把可变字段纳入 `equals` 却把实例放进 `HashMap` 后改字段，会出现「get 不到自己」——不是 map 坏了，是契约被破坏。Kotlin `==` 调用 `equals`，`===` 才是引用同一；String 字面量驻留使 `===` 偶尔巧合成立，不能当语义。`data class` 自动生成契约，但 `copy` 改字段不等于原地更新容器里的旧对象。对比：用 `identityHashCode` 的集合与按值相等的集合适用场景相反。见 `kp-equals-hashcode`、`kp-string-immutability`。

### 3. 空安全、平台类型与承诺（P0 必会）

可空类型把 NPE 往前推到编译期；Java 互操作处是**平台类型**，编译器不帮你证明非空。`!!`、`lateinit`、`checkNotNull` 都是把证明责任交回开发者，失败仍是 NPE，只是换了一个语法糖。边界：混合工程里 Kotlin 非空参数接 Java `@Nullable` 无强制失败——谁先信任谁承担线上。与 Optional：Kotlin 倾向用 `?` 和 Elvis，而不是层层 `get()`。smart cast 依赖「同一分支内不可变且没别名」，`var` 或并发读写会使 smart cast 失效。见 `kp-null-safety`。

### 4. 代数类型与穷尽性（P0 必会）

`sealed` 把合法状态闭包在类型系统里，`when` 不需 `else` 也能穷尽——改分支漏编译报错，比字符串枚举安全。`data` 承载值相等与解构，适合 DTO/UI state；与 `enum class` 对比：enum 实例固定，`sealed` 可带不同载荷。失败模式：用 `open class` + 子类当 state，重构时漏改分支运行期才暴露。见 `kp-data-sealed`。

### 5. 集合只读契约与结构共享（P0 必会）

Kotlin 的 `List` 只读是**编译期视图**，底层仍可能是 `ArrayList`；返回给 Java 调用方时被 `add` 并不违反 JVM 规则。`toList()` 与 `asList` 是否复制要看 API；结构共享下改子列表可能影响母列表。迭代中结构性修改触发 `ConcurrentModificationException`（fail-fast 迭代器）。与 `CopyOnWriteArrayList` 对比：读多写少才值得。见 `kp-collections`。

### 6. 泛型擦除、型变与 reified（P0 必会，reified 为专家加分）

运行时 `List<String>` 与 `List<Int>` 都是 `List`，`is List<String>` 在 JVM 上非法或只检裸类型。声明处型变 `out`/`in` 在编译期禁止会破坏型变的不变操作（协变不能 `add`）。`reified` 必须配合 `inline` 在调用点展开具体类型，跨模块 API 面不能拿来当「泛型反射」万能钥匙。失败模式：在 Kotlin 里用强制转换补擦除洞，ClassCastException 推迟到运行期。见 `kp-generics`。

### 7. 扩展、内联与高阶（P0 必会）

扩展是静态派发，子类不能 override 扩展函数；与成员函数同时存在时**成员优先**。`inline` 把 lambda 内联消除对象分配，但把 lambda 存进字段需要 `noinline`/`crossinline` 约束。非 inline 高阶在 JVM 上常 SAM 化或生成装箱类。对比 Java 8 lambda：捕获变量与桥方法仍要注意interop。见 `kp-extensions-hof`。

### 8. 互操作与二进制稳定（P0 必会）

`@JvmName`、`@JvmOverloads`、`@JvmStatic` 改的是 Java 看到的形状；改 Kotlin 默认参数顺序可破坏 Java 二进制兼容。`internal` 编译为 `public` + 模块名 mangling，Java 仍能调到。集合映射：Kotlin `List` 可能是只读包装，Java 侧写入会改变共享后端。失败模式：库作者把实现类放进 `api` 依赖，消费者被锁死在具体类型上。见 `kp-java-kotlin-interop`、`kp-annotations-exceptions`。

## 使用与实践

推荐复习顺序，每步限时两分钟口述，讲不出 why 就只重读该篇对应小节：

1. **分派与关键字。** `kp-oop-basics` → 重载/重写各举 Activity/Fragment 里一例。
2. **引用。** `kp-val-var-lazy` → 单例与 `by lazy` 谁先初始化。
3. **String。** `kp-string-immutability` → 拼接为什么用 `buildString` 不是 `+` 循环。
4. **相等。** `kp-equals-hashcode` → `HashMap` 用可变 key 错在哪。
5. **空安全。** `kp-null-safety` → `?.let` 与 `if (x != null)` smart cast 差在哪。
6. **密封与 data。** `kp-data-sealed` → UI 状态建模为什么选 `sealed`。
7. **集合。** `kp-collections` → 结构共享下复制还是改视图。
8. **泛型。** `kp-generics` → `MutableList<out Cat>` 为什么不能 `add`。
9. **扩展与高阶。** `kp-extensions-hof` → `inline` 对 lambda 分配的影响。
10. **注解异常。** `kp-annotations-exceptions` → 检查异常在 Kotlin 里的态度。
11. **互操作。** `kp-java-kotlin-interop` → 混编模块 null 谁负责检。
12. **串讲。** 用「网络 DTO + Room Entity + UI State」走一遍：data/sealed、空安全、equals、集合只读出口。

验收追问：

- 改 `data class` 一个字段后，为什么 `Set` 里还占着「旧对象」？
- Java 调 Kotlin 带默认参数的函数，删一个参数会怎样？
- `inline` 函数里把 lambda 存进字段，编译器为什么拒绝？

## 例子

```text
UI 状态：sealed interface UiState { data class Ok(val list: List<Item>) : UiState; data object Loading : UiState }
  Item 是 data class，进 HashSet 做去重 → equals/hashCode 契约必须稳
  从 Java JSON 解析进 Kotlin：字段可空用 ?，禁止把平台类型直接塞给非空 API
错路：data class 当 key 放进 Map 后再 item = item.copy(score = 1) 再 get → miss
对路：不可变 key，或不用可变字段参与 equals
```

## 画面

```text
roadmap order:1
  |
分派 oop-basics
  -> val/var/lazy -> string -> equals/hash
  -> null -> data/sealed -> collections -> generics
  -> extensions/hof -> annotations -> java-kotlin-interop
```

## 常见坑与追问

1. **把 `==` 讲成引用相等。** Kotlin `==` 是 `equals`；引用相等是 `===`。追问：String 比较为什么要用 `==` 不用 `===`？
2. **以为扩展能 override。** 子类加同名扩展不覆盖父类成员；追问：扩展和成员优先级？
3. **泛型当运行时存在。** `is List<String>` 在 JVM 上是什么？擦除后只剩 `List`。
4. **只读集合暴露可变引用。** `List` 返回实际上是 `ArrayList`；Java 仍能 `add`。追问：Kotlin 只读契约边界？
5. **互操作跳过 null 注解。** Kotlin 非空参数接到 Java `@Nullable`；追问：谁来保证不 NPE？
