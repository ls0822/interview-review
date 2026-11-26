# Agent 收件箱

用户标注（明白 / 不懂）同步到这里，供 Cursor / 其它 Agent 读取并改题库。

| 文件 | 用途 |
|------|------|
| `source.json` | 拉取地址配置（Agent 先读） |
| `latest.md` | 最新标注摘要 |
| `latest.json` | 含 `syncId` / `status` / 结构化数据 |
| `processed.json` | 已处理过的 `syncId` 列表 |

## 用户怎么同步

1. App → **同步设置**：填 GitHub Owner/Repo/Branch + Fine-grained Token（本仓库 Contents 读写）
2. 点 **同步给 Agent** → 上传 `latest.md` + `latest.json`（每次新 `syncId`，`status=pending`）
3. 本机 `npm run dev` 时还会写本地目录；手机 Pages 走 GitHub 上传

## Agent 怎么拉 / 怎么判断是否处理过

```bash
npm run pull-inbox
```

或手动：

1. 读 `source.json` → 拉 `latestJsonUrl` / `latestMdUrl` / `processedUrl`
2. 看 `latest.json.syncId`：若已在 `processed.json.processed[].syncId` → **跳过**
3. 否则按「不懂」改 `review-content/`，然后把该 `syncId` 写入 `processed.json`（App 设置页也可点「标记最近批次已处理」）
