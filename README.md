# 面试复习工具（第一版）

按模块看知识点、一问一答自判、错题本 / 待复习、算法题面与答案。  
题库是 `review-content/` 里的 Markdown；进度存在浏览器本地。  
推送到 GitHub 后由 Actions 部署 Pages，手机打开网站即用最新题库。

## 本地运行

```bash
cd interview-review
npm install
npm run dev
```

浏览器打开终端里提示的地址。

## 改题（给 Agent）

见 [AGENTS.md](./AGENTS.md)。示例：

- 改 `review-content/**/*.md`，升 `version`
- 新术语写入 `review-content/glossary.yaml`
- `git push` → 自动部署

本地预览打包：

```bash
npm run content   # 生成 public/content-pack.json
npm run build
```

## GitHub Pages

1. 把本目录建成独立仓库（或 monorepo 根目录含本项目时改 workflow 路径）。
2. 仓库 Settings → Pages → Source 选 **GitHub Actions**。
3. 若站点挂在 `https://user.github.io/repo/`，把 `vite.config.js` 的 `base` 改成 `'/repo/'`。

## 已实现

- 知识点（含例子/画面）→ 标已读 → 练相关问答
- 模块内直接练 / 随机；整体随机
- 会了 / 半会 / 不会；错题本
- 内容 `version` 升高后标「需再练」
- 英文术语点击/长按：释义 + 系统读音
- 算法：题目 + 答案 + 完成标记

## 当前题库

从 `../复习/` **全量导入**：知识点约 230、问答约 196、算法约 92。

| 模块 | 来源 |
|------|------|
| 项目口述 | 项目重点.md |
| 协程 / 并发 / JVM / 语言 | 协程专题、第1天细稿、Java线程、JVM原理、Kotlin说人话、混编详解 |
| Android / 网络 / 架构 / Compose / 三方 | 基础知识 02–06、市场补充 |
| Agent | Agent与AICoding.md |
| 算法 | 基础算法.md 必刷/次刷题 |

重新全量导入（会覆盖 `review-content/`）：

```bash
node scripts/import-all-from-复习.mjs
npm run content
```

每条知识点固定含：一句话、详细说明、例子、画面。

## 未做（后续）

- 账号与进度上云
- 在线词典补全（目前靠 glossary）
- 手机原生 App
- 第 2/3 天材料入库
