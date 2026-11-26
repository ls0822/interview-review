---
id: kp-agent-rules-skills
type: knowledge
module: agent
title: Rules、Skills、MCP 与 Plugin
priority: P0
version: 2
requires: [kp-agent-what]
order: 30
---

## 一句话

**Rules** 每条对话都占位的短约束，**Skills** 触发才加载的长步骤，**MCP** 把仓库外工具接成可调用 API，**Plugin** 把这整套打成可分发安装包——四层各管一事，混用会要么占满上下文要么规矩失效。

## 组成与结构

| 层 | 生命周期 | 装什么 | 反例 |
|----|----------|--------|------|
| Rules | 每轮 | 语言、禁区目录、必跑检查 | 把排查教程塞满规则 |
| Skills | 触发读入 | 输入/步骤/输出/停机 | 「请仔细分析」无步骤 |
| MCP | 调用时 | 日志/工单/浏览器等工具 | 密钥写进 prompt |
| Plugin | 安装时 | 打包 rules+skills+MCP+钩子 | 当商品卖安装包本身 |

关系句：Rules 管规矩，Skills 管流程，MCP 管手脚，Plugin 管分发。

Gradle 类比（仅助记）：Rules≈全局约定，Skills≈运维文档，MCP≈对外 API，Plugin≈可安装 bundle——不是 Gradle 插件在调模型。

Cursor 市场 Plugin 通常不收「安装费」；真收费放在你的日志查询等服务配额上。

## 原理

1. **Rules 必须短因占永久上下文。** 长文挤代码与日志，遵守率下降。一条一检：`公开 API 不动`、`回答中文`、`提交前 npm test`——可布尔检查。深度流程不 belongs here。
2. **Skills 按需因成本与干扰。** 触发条件写清（用户要查 ANR、要加设置页）；步骤写输入、工具调用、输出 schema、**明确停机**。模型 relevance 判断才读入，不是每次全库技能。
3. **MCP 是工具宿主不是第二模型。** 统一 schema 暴露 `query_logs(room, from, to)` 等；鉴权、脱敏、超时在服务端。模型只见允许字段。挂了就应**失败可见**，别静默幻觉补日志。
4. **Plugin 解决组织一致性。** 一人本地好用的 rules/skills/MCP，同事缺文件就口径分裂。Plugin 版本要与仓库约定同升，否则半套旧字段名。
5. **三层叠在同一任务。** Rules 始终约束「不改 keep」；Skill 触发走排查模板；MCP 产带行号日志。缺一层：无 MCP 则模型臆造日志；无 Skill 则每轮步骤漂移；无 Rules 则 diff 改飞。
6. **边界与失败模式。** Skill 未安装云端不存在；MCP 超时要返回错误给模型而非空字符串当成功；把脱敏写在 prompt 而非服务端，一旦要「贴原文」规则被绕过。

专家：Hooks（保存/提交前）与 Rules 不同——钩子是确定性脚本，Rules 是软约束给模型；两者可同 Plugin 分发。

## 使用与实践

排查包四层示例：

- Rule：不改线上开关/keep；结论带路径；提交说明不写用户 id。
- Skill：输入现象+房间+时间窗 → 调 MCP 拉日志 → 对类 → 模板输出+停机等人。
- MCP：`query_logs` 参数校验+脱敏+行数上限。
- Plugin：客户端组统一安装。

写代码 Rules 另文件，不与排查 Skill 糊成长 md。密钥在 MCP 配置/服务端，Skill 正文可入库。

不该：查询 SQL 写进 Rule；「必须中文」只放 Skill（未触发则失效）；Plugin 代替服务端鉴权。

## 例子

Skill 骨架：

```text
输入：现象、roomId、userId、[from,to]
1. MCP query_logs(...)
2. 从栈抽 class → 仓库打开
3. 输出：原因|路径|置信|下一步|未知项
4. STOP：不改文件、不发布
```

Rules 仅短句：`禁止改 public SDK 签名` / `回答简体中文`。

错例：Skill 里写 `apiKey=sk-xxx` 提交 Git。对例：本机 `mcp.json` 或密钥服务，Skill 只写参数名。

错例：50 条排查细节全进 `.cursor/rules`，每轮占 8k token。对例：Rule 三条，Skill 一篇按需加载。

## 画面

```text
始终：Rules（短）
触发：Skills（步骤）
外设：MCP（工具）
分发：Plugin（打包）
```

## 常见坑与追问

1. **排查教程全进 Rules。** 追问：占上下文、遵守率差；长流程进 Skill。
2. **MCP 是另一个 LLM。** 追问：提供 tools/resources，推理仍主模型。
3. **卖 Plugin 安装包。** 追问：收费在服务；Plugin 是分发。
4. **密钥进 Skill 仓库。** 追问：放 MCP 配置/密钥管理。
5. **无 MCP 仍要精确行号。** 追问：要么接工具要么人手贴日志；别虚构行号。