import { buildMasteryExport } from './progress.js'
import { buildAgentPrompt, listNotes } from './feedback.js'
import { loadSyncConfig, hasGithubAuth, buildSourceJson } from './syncConfig.js'
import { uploadInboxToGithub, fetchProcessedList } from './githubInbox.js'

function newSyncId() {
  return `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function buildInboxPayload(pack, progress) {
  const syncId = newSyncId()
  const updatedAt = new Date().toISOString()
  const notes = listNotes().filter((n) => n.status !== 'done')
  const mastery = buildMasteryExport(pack, progress)
  const feedback = buildAgentPrompt(notes)

  const envelope = {
    syncId,
    status: 'pending',
    updatedAt,
    source: buildSourceJson(loadSyncConfig()),
    progress,
    notes,
  }

  const markdown = [
    '# 学习标注（Agent 收件箱）',
    '',
    `syncId: \`${syncId}\``,
    `status: pending`,
    `updatedAt: ${updatedAt}`,
    '',
    '> Agent：先核对 `agent-inbox/processed.json`（或 source 里的 processedUrl）。若已含此 syncId，跳过；否则按「不懂」改题库，处理完写入 processed。',
    '',
    '请先读本文件与 `latest.json`，再改 `review-content/`，按 AGENTS.md 执行。',
    '',
    mastery,
    '',
    '---',
    '',
    '## 反馈箱原文',
    '',
    feedback,
    '',
  ].join('\n')

  return { syncId, markdown, envelope }
}

async function writeLocalWorkspace(markdown, envelope) {
  try {
    const res = await fetch('/api/agent-inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markdown,
        progress: envelope.progress,
        notes: envelope.notes,
        envelope,
        updatedAt: Date.now(),
      }),
    })
    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: true, path: data.path || 'agent-inbox/latest.md' }
    }
  } catch {
    // Pages / 无中间件
  }
  return { ok: false }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 同步标注：
 * 1) 本机 dev → 写 agent-inbox/
 * 2) 已配置 Token → 推 GitHub（手机 Pages 主路径）
 * 3) 都没有 → 下载 latest.md 兜底
 */
export async function syncAgentInbox(pack, progress, options = {}) {
  const preferGithub = options.preferGithub !== false
  const allowDownloadFallback = options.allowDownloadFallback ?? preferGithub
  const cfg = loadSyncConfig()
  const { syncId, markdown, envelope } = buildInboxPayload(pack, progress)

  const result = {
    ok: true,
    syncId,
    modes: [],
    urls: null,
    hint: '',
  }

  const local = await writeLocalWorkspace(markdown, envelope)
  if (local.ok) {
    result.modes.push('workspace')
    result.path = local.path
  }

  if (preferGithub && hasGithubAuth(cfg)) {
    try {
      const processed = await fetchProcessedList(cfg)
      envelope.alreadyKnownProcessed = processed.map((x) => x.syncId).filter(Boolean).slice(0, 20)
      const up = await uploadInboxToGithub({ markdown, envelope })
      if (up.ok) {
        result.modes.push('github')
        result.urls = up.urls
      }
    } catch (err) {
      result.githubError = err?.message || String(err)
    }
  }

  if (!result.modes.length) {
    if (!allowDownloadFallback) {
      result.ok = false
      result.hint = result.githubError
        ? `未写入（GitHub: ${result.githubError}）`
        : '未写入远端：请点「同步给 Agent」或到「同步设置」配置 Token'
      return result
    }
    downloadText('latest.md', markdown)
    downloadText('latest.json', JSON.stringify(envelope, null, 2))
    result.modes.push('download')
    result.hint = hasGithubAuth(cfg)
      ? `下载兜底（GitHub 失败: ${result.githubError || '未知'}）`
      : '未配置 GitHub Token：已下载文件。请到「同步设置」填写 Token 后重试，或把文件放进 agent-inbox/'
  } else if (result.modes.includes('github')) {
    result.hint = `已上传 GitHub · ${syncId}`
  } else if (result.modes.includes('workspace')) {
    result.hint = hasGithubAuth(cfg)
      ? `已写入本地 · ${syncId}` + (result.githubError ? `（GitHub: ${result.githubError}）` : '')
      : `已写入本地 agent-inbox · ${syncId}（未配置 Token，远端 Agent 需再点同步上传）`
  }

  try {
    localStorage.setItem(
      'interview-review-last-sync-v1',
      JSON.stringify({ syncId, at: Date.now(), modes: result.modes }),
    )
  } catch {
    /* ignore */
  }

  return result
}

export function getLastSyncMeta() {
  try {
    return JSON.parse(localStorage.getItem('interview-review-last-sync-v1') || 'null')
  } catch {
    return null
  }
}
