# Agent 改题规则

本仓库是面试复习工具。题库源文件只在 `review-content/`。

## 用户标注（最高优先）

用户点「这节明白 / 不懂」是为了让你看见并改讲解，不是只存在浏览器。

### 拉取

1. 读 `agent-inbox/source.json`（固定配置）。
2. 执行 `npm run pull-inbox`，或按 source 里的 URL 拉：
   - `latest.json`（看 `syncId` / `status`）
   - `latest.md`
   - `processed.json`
3. 若本地已有较新文件且用户说「刚同步在本机」，可直接读仓库内 `agent-inbox/latest.*`。

### 是否已处理

- 每个上传批次有唯一 `syncId`，初始 `status: pending`。
- 若 `processed.json` 的 `processed[].syncId` **已包含**该 id → **跳过**，不要重复改。
- 处理完：把 `{ syncId, processedAt, note }` 写入 `processed.json` 并提交；或让用户在 App「同步设置 → 标记最近批次已处理」。

### 怎么改

1. 优先处理「不懂」；「明白」勿重复灌水。
2. 改 `review-content/_full/<id>.md`（白话 + 最小例子），再  
   `node scripts/apply-full-knowledge.mjs && npm run content`
3. 相关 frontmatter `version` +1；回报 `syncId` 与改动的 id。

## 改内容时

1. 只改 `review-content/` 下的 Markdown / YAML。不要手改 `public/content-pack.json`（由 `npm run content` 生成）。
2. 改问题、答案、知识点正文（含例子/图）→ 该文件 front matter 的 `version` **+1**。
3. 只改 `priority` 可不升 `version`。
4. **不要改 `id`**，除非用户明确要求新建题（新文件用新 id）。
5. 新知识点必须含：一句话、组成与结构、原理、使用与实践、**例子**、**画面**、常见坑与追问。标题用主题名，**不要**写成问句（问句只给 `type: qa`）。
6. 完整深度稿源在 `review-content/_full/`。改深度内容优先改 `_full/`，再执行 `node scripts/apply-full-knowledge.mjs && npm run content`。`_full` 不会打进 content-pack。
7. 出现新的英文面试术语时，补进 `review-content/glossary.yaml`（含 `phonetic` IPA 与 `speak` 朗读文本）。
8. 个人标注只进 `agent-inbox/`，不要写进题库正文。

## 用户粘贴反馈时

若用户粘贴了反馈箱提示词，同样按 id 改 `_full/` → apply-full → content → version +1。

正文里的「画面」在 UI 会显示为「结构示意」（脑内建模示意图，不是配图）。

## 发布

1. `git pull`
2. 改题
3. 本地可 `npm run content` 预览
4. `git add` + `commit` + `push` → GitHub Actions 自动部署 Pages

用户说「拉取最新，改某某并推送」时按上面做，并回报改了哪些 `id` 与新 `version`。
