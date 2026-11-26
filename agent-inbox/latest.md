# 学习标注（Agent 收件箱）

syncId: `sync-mwxcjn87-as72`
status: pending
updatedAt: 2026-11-26T09:25:00.631Z

> Agent：先核对 `agent-inbox/processed.json`（或 source 里的 processedUrl）。若已含此 syncId，跳过；否则按「不懂」改题库，处理完写入 processed。

请先读本文件与 `latest.json`，再改 `review-content/`，按 AGENTS.md 执行。

请根据我的学习标注整理协程（或其它模块）复习状态，并针对「未明白」处加深讲解。

## 知识点章节标注
### Flow 冷热流、StateFlow 与 replay (kp-coroutine-flow)
- [不懂] 使用与实践
- [不懂] 原理

## 问答掌握
- 会了: 0 · 半会: 0 · 不会: 0

---

## 反馈箱原文

请根据下面的学习反馈，批量补充/改写面试复习题库。

规则：
1. 优先改 `interview-review/review-content/_full/` 对应知识点，再执行 `node scripts/apply-full-knowledge.mjs && npm run content`。
2. 知识点标题保持主题名（非问句）；问答才用提问形式。
3. 针对「不懂」处：用更白话重写该段原理，并加一个最小例子；必要时补术语到 glossary.yaml。
4. 改完后把相关 frontmatter 的 version +1。
5. 改完后告诉我改了哪些 id。

反馈列表：
1. [不懂/要解释] Dispatcher 与线程池选择 (id=kp-coroutine-dispatchers, 章节=例子)
   模块: coroutine
   用户说: val raw = withContext 返回的是什么？ 一定要返回东西吗？

2. [不懂/要解释] Dispatcher 与线程池选择 (id=kp-coroutine-dispatchers, 章节=原理)
   模块: coroutine
   用户说: IO 和 Default  的区别在哪？ 都是自线程吗？

3. [不懂/要解释] 协程取消、异常与监督 (id=kp-coroutine-cancel, 章节=例子)
   模块: coroutine
   用户说: 不太理解说的是什么

4. [不懂/要解释] 协程取消、异常与监督 (id=kp-coroutine-cancel, 章节=组成与结构)
   模块: coroutine
   用户说: 父子规则：父取消，所有子取消。普通父 Job 下，一个子抛出普通异常，父失败，兄弟取消。监督关系里，这个子自己失败，兄弟继续，异常如果没在子内部处理，会走上下文里的异常处理器。

具体父子关系，父是指的 launch 的 job 吗？ 子是指 job 里面的 job 吗？

5. [不懂/要解释] launch、async、withContext 与 Scope (id=kp-coroutine-builders, 章节=原理)
   模块: coroutine
   用户说: 1.launch 出来的 Job 父级是当前 Scope 的 Job，这一句， 是launch 出来的 Job 的父类是Scope 的 Job吗？还是 Job 属于 Scope？ 
2. 什么是兄弟？
3. coroutineScope 和 supervisorScope 具体是什么？用于做什么的？
4. Scope 的 Job 用 SupervisorJob 的原因。 viewModelScope 用 SupervisorJob ，这个是不是说  viewModelScope 时一个 SupervisorScope？
5. Dispatchers.Main.immediate 的 immediate 时什么？

6. [不懂/要解释] launch、async、withContext 与 Scope (id=kp-coroutine-builders, 章节=组成与结构)
   模块: coroutine
   用户说: 2. launch 和 async 的作用是一样的吗？ 表示什么意思呢？ async 返回的对象是什么呢？ 
3. 如果协程中， 有一个 withContext ，withContext 下方还有一行代码，是必须 withContext 执行完，下一行才会执行吗？我可以理解为， withContext 时，会把当前的协程挂起，并启动了一个新的代码块执行，新的协程执行代码块，执行完成后，再恢复当前协程，走后续代码，是否正确？ 协程方法是不是也是和 withContext 类似，将当前协程挂起，启动一个新的协程任务执行挂起函数，执行完成后，在恢复当前的协程，继续执行？ 什么时候才会需要挂起函数呢？ 挂起函数是执行在说什么 spoce，什么线程上呢？

