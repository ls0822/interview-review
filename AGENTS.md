# Agent 改题规则（面试复习工程）

题库源只在 `review-content/`。  
完整规格：`docs/CONTENT_SPEC.md`  
生成边界：`docs/CONTENT_BOUNDARY.md`  
专家深度（默认生成标准）：`docs/EXPERT_DEPTH.md`

## 规范放在哪

| 位置 | 用途 |
|------|------|
| 仓库上级 `.cursor/rules/interview-review-*.mdc` | Cursor 始终启用 |
| `AGENTS.md`（本文件） | 工作流与发布 |
| `docs/CONTENT_SPEC.md` | 形态/台阶/放置/自检 |
| `docs/CONTENT_BOUNDARY.md` | 生成边界 |
| `agent-inbox/` | 用户标注收件箱 |

改题前后执行：`npm run validate-content`（结构不合规须先修）。

---

## 用户标注（最高优先）

1. 读 `agent-inbox/source.json` → `npm run pull-inbox`（或读本地 `latest.*`）。
2. `latest.json.syncId` 若已在 `processed.json` → **跳过**。
3. 只处理「不懂」；「明白」不扩写。
4. 改 `_full/<id>.md`（白话+最小例子）→ `node scripts/apply-full-knowledge.mjs && npm run content` → 相关 `version +1`。
5. 写入 `processed.json` 该 syncId；回报 syncId 与改动 id。

---

## 改内容硬约束

1. 只改 `review-content/**`；禁止手改 `public/content-pack.json`。
2. 正文/答案/例子变了 → `version +1`；只改 priority 可不升。
3. **禁止改 `id`**（新建用新 id）。
4. knowledge：主题名标题 + 七段齐全；问句只给 qa。
5. 有 `_full` 则只改 `_full/` 再 apply；`_full` 不进 content-pack。
6. 新英文术语 → `glossary.yaml`（phonetic / speak）。
7. 标注不进题库正文。

## 质量与台阶（摘要）

- **默认专家级深度**（`EXPERT_DEPTH.md`）：生成时即按资深面试可追问标准写，不是先浅后补。
- 篇内按七段坡度写；术语延后；一点一进。
- 篇间用 `requires` / `order`；不跳先修。
- 新 kp：主考模块 + 能并入则并入；交卷报放置理由。
- 改完过 CONTENT_SPEC + EXPERT_DEPTH 自检；二次不懂必须降坡。

## 发布

1. `git pull` → 改题 → `npm run validate-content` → `npm run content`
2. 用户要求时再 commit / push（Actions 部署 Pages）

用户说「拉取标注并改」时：pull-inbox → 按边界最小改 → validate → 回报。
