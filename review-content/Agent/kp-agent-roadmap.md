---
id: kp-agent-roadmap
type: knowledge
module: agent
title: Agent 掌握地图与复习顺序（专家）
priority: P0
version: 2
order: 1
---

## 一句话

Agent 面试要讲清「模型 + 工具 + 编排 + 约束」：不是聊天套壳，而是可验证的任务循环；Rules/Skills 是可复用的策略层，Workflow 管步骤与失败恢复。

**P0** 定义边界、工作流形态、规则与技能分工。**专家加分**是上下文预算、工具鉴权、人机协同与审计。

## 组成与结构

| 层 | 要回答的问题 | 主篇 | 档 |
|----|----------------|------|----|
| 是什么 | Agent vs 脚本 vs Copilot | `kp-agent-what` | P0 必会 |
| 工作流 | 计划、执行、观测、重试 | `kp-agent-workflow` | P0 必会 |
| 规则与技能 | 持久约束 vs 按需能力包 | `kp-agent-rules-skills` | P0 必会 |

顺序与 order 一致：概念 → 编排 → 策略资产化。

P0：

- Agent 对不确定环境做感知-决策-行动循环；工具是带 schema 的副作用入口。
- Workflow 显式步骤：失败是分支不是崩；人审在环适用于高风险。
- Rules 全局守底线；Skills 在匹配任务时加载，省上下文。

专家加分：

- MCP 等工具协议：发现、鉴权、超时。
- 多 Agent 分工与冲突消解（口述边界即可）。

## 原理

这一节讲清「感知-决策-行动闭环、工具边界、上下文预算、Rules/Skills 分工、研发场景落地」。

### 1. Agent 闭环 vs 脚本/聊天（P0 必会）

Agent 对**不确定环境**：观测状态→规划→调用工具→读结果→再规划，直到终止条件。脚本：路径固定，分支靠手写；Copilot：补全片段，无长期目标与工具副作用。对比 FAQ bot：无工具、无状态机、无失败恢复。失败模式：把多轮聊天当 Agent，没有结构化观测与重试。见 `kp-agent-what`。

### 2. 可观测与可回放（P0 必会）

每步沉淀：系统提示、用户目标、模型输出、工具名与参数、工具返回值、最终答案。便于回归（同一 inbox 是否改对）与审计。与黑盒 API 对比：研发 Agent 必须能 explain why 调了 `validate-content`。失败模式：只留最终 diff，无法复盘错误工具调用。见 `kp-agent-workflow`。

### 3. 工具安全与权限（P0 必会）

工具是带 schema 的副作用入口：写文件、跑 shell、调外部 API。最小权限：改题库只许 `review-content/**`；高危要人审或二次确认。错误信息回灌模型时脱敏 token/PII。对比「让模型直接跑任意 shell」：注入与误删不可控。MCP 等协议要解决发现、超时、鉴权。失败模式：无 timeout 的工具挂死整个 workflow。

### 4. 上下文工程（P0 必会）

上下文窗口有限；长任务靠滚动摘要、外部记忆（仓库路径、processed.json）、**按需加载** Skill 而不是一次塞全库规则。与 RAG 对比：Skill 是结构化规程，RAG 是碎片检索。失败模式：Rules 堆成万行，模型只见开头，边界约束失效。

### 5. Rules 与 Skills 分工（P0 必会）

Rules：**始终**生效的硬约束（不改 public pack、version 递增、最小改动）。Skills：**匹配任务**时读入的工作流（apply-full 顺序、inbox 处理）。防重复：Skill 里步骤，Rules 里底线。专家边界：同一指令既写 Rule 又写 Skill 会 token 浪费与冲突。见 `kp-agent-rules-skills`。

### 6. 失败恢复与人在环（P0 必会）

工具失败要分支：重试（有上限）、换策略、escalate 给人。不能无限重试同一错误。高风险（全库重写、force push）默认禁止，需用户明示。与本仓库对照：pull-inbox → 只改不懂 → validate → content 是标准 DAG。

### 7. 与软件架构隐喻（专家加分）

单向数据流类似 Agent：状态（仓库/测试报告）上行，动作（patch）下行；副作用在 workflow 边界执行。面试可把「IM 状态机」与「Agent 循环」类比，但别混掉「模型非确定」风险。

## 使用与实践

1. `kp-agent-what` — 两分钟定义 + 反例（纯 FAQ bot）。
2. `kp-agent-workflow` — 画循环：plan → act → observe。
3. `kp-agent-rules-skills` — 举例本仓库 interview-review 工作流。

与 `kp-arch-patterns` 类比：单向数据流类似「状态上、副作用管」。

## 例子

```text
对：改题库 workflow = pull-inbox → 只改不懂 → validate → content
错：让 Agent 无规则全库重写
对：Rules 锁边界，Skill 教步骤
```

## 画面

```text
agent-what (定义)
    |
agent-workflow (循环)
    |
agent-rules-skills (约束与能力包)
```

## 常见坑与追问

1. **Agent 等于 LLM 多轮聊天。** 追问：工具调用谁来校验参数？
2. **无失败策略的死循环重试。** 追问：何时 escalate 给人？
3. **Rules 与 Skill 堆成一本手册。** 追问：何时拆 skill？
4. **忽略审计与隐私。** 追问：日志里脱敏什么？
5. **吹全自动不谈人机分工。** 追问：CR 谁负责？
