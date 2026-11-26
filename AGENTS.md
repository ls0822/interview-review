# Agent 改题规则

本仓库是面试复习工具。题库源文件只在 `review-content/`。

## 改内容时

1. 只改 `review-content/` 下的 Markdown / YAML。不要手改 `public/content-pack.json`（由 `npm run content` 生成）。
2. 改问题、答案、知识点正文（含例子/图）→ 该文件 front matter 的 `version` **+1**。
3. 只改 `priority` 可不升 `version`。
4. **不要改 `id`**，除非用户明确要求新建题（新文件用新 id）。
5. 新知识点必须含：一句话、组成与结构、原理、使用与实践、**例子**、**画面**、常见坑与追问。标题用主题名，**不要**写成问句（问句只给 `type: qa`）。
6. 完整深度稿源在 `review-content/_full/`。改深度内容优先改 `_full/`，再执行 `node scripts/apply-full-knowledge.mjs && npm run content`。`_full` 不会打进 content-pack。
7. 出现新的英文面试术语时，补进 `review-content/glossary.yaml`（含 `phonetic` IPA 与 `speak` 朗读文本）。
8. 进度数据在浏览器本地，不要写入题库文件。

## 用户「不懂」反馈怎么批量改

用户在 App 里点「这节不懂 / 整篇不懂」会攒到本地反馈箱，再「复制给 Agent」粘贴到对话。

收到这类粘贴后：

1. 按反馈里的 `id` 改 `review-content/_full/<id>.md`（白话重写不懂段 + 最小例子；有误则修正；要加深则扩原理）。
2. 需要新术语 → `glossary.yaml`（含 phonetic / speak）。
3. `node scripts/apply-full-knowledge.mjs && npm run content`
4. 相关 `version` +1；回报改了哪些 id。

正文里的「画面」在 UI 会显示为「结构示意」（脑内建模示意图，不是配图）。

## 发布

1. `git pull`
2. 改题
3. 本地可 `npm run content` 预览
4. `git add` + `commit` + `push` → GitHub Actions 自动部署 Pages

用户说「拉取最新，改某某并推送」时按上面做，并回报改了哪些 `id` 与新 `version`。
