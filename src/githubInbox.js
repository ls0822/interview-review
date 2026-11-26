import { loadSyncConfig, hasGithubAuth, rawUrl } from './syncConfig.js'

function b64EncodeUtf8(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary)
}

function b64DecodeUtf8(b64) {
  const binary = atob(String(b64 || '').replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

async function githubRequest(cfg, path, init = {}) {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  })
  return res
}

async function getFileSha(cfg, path) {
  const res = await githubRequest(cfg, `${path}?ref=${encodeURIComponent(cfg.branch)}`)
  if (res.status === 404) return null
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `读取 ${path} 失败 (${res.status})`)
  }
  const data = await res.json()
  return data.sha || null
}

async function putFile(cfg, path, content, message) {
  const sha = await getFileSha(cfg, path)
  const body = {
    message,
    content: b64EncodeUtf8(content),
    branch: cfg.branch,
  }
  if (sha) body.sha = sha
  const res = await githubRequest(cfg, path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `写入 ${path} 失败 (${res.status})`)
  }
  return res.json()
}

/** 把 latest.md / latest.json 推到仓库；可选刷新 source.json */
export async function uploadInboxToGithub({ markdown, envelope }) {
  const cfg = loadSyncConfig()
  if (!hasGithubAuth(cfg)) {
    return { ok: false, reason: 'missing-token' }
  }

  const mdPath = cfg.paths.latestMd
  const jsonPath = cfg.paths.latestJson
  const syncId = envelope.syncId
  const msg = `chore(agent-inbox): sync ${syncId}`

  await putFile(cfg, mdPath, markdown, msg)
  await putFile(cfg, jsonPath, JSON.stringify(envelope, null, 2) + '\n', msg)

  return {
    ok: true,
    syncId,
    urls: {
      latestMd: rawUrl(cfg, mdPath),
      latestJson: rawUrl(cfg, jsonPath),
    },
  }
}

/** 读取远端 processed.json（无则空列表） */
export async function fetchProcessedList(cfg = loadSyncConfig()) {
  if (!hasGithubAuth(cfg)) {
    // 无 token 时尝试 raw（公开仓可读）
    try {
      const res = await fetch(rawUrl(cfg, cfg.paths.processed) + `?t=${Date.now()}`)
      if (!res.ok) return []
      const data = await res.json()
      return Array.isArray(data.processed) ? data.processed : []
    } catch {
      return []
    }
  }
  const res = await githubRequest(cfg, `${cfg.paths.processed}?ref=${encodeURIComponent(cfg.branch)}`)
  if (res.status === 404) return []
  if (!res.ok) return []
  const data = await res.json()
  try {
    const parsed = JSON.parse(b64DecodeUtf8(data.content))
    return Array.isArray(parsed.processed) ? parsed.processed : []
  } catch {
    return []
  }
}

/** 标记某 syncId 已处理，写回 processed.json */
export async function markSyncProcessed(syncId, note = '') {
  const cfg = loadSyncConfig()
  if (!hasGithubAuth(cfg)) throw new Error('未配置 GitHub Token')
  if (!syncId) throw new Error('缺少 syncId')

  let existing = []
  try {
    const res = await githubRequest(cfg, `${cfg.paths.processed}?ref=${encodeURIComponent(cfg.branch)}`)
    if (res.ok) {
      const data = await res.json()
      const parsed = JSON.parse(b64DecodeUtf8(data.content))
      existing = Array.isArray(parsed.processed) ? parsed.processed : []
    }
  } catch {
    existing = []
  }

  const filtered = existing.filter((x) => x.syncId !== syncId)
  filtered.unshift({
    syncId,
    processedAt: new Date().toISOString(),
    note: note || '',
  })

  const body = {
    updatedAt: new Date().toISOString(),
    processed: filtered.slice(0, 100),
  }
  await putFile(
    cfg,
    cfg.paths.processed,
    JSON.stringify(body, null, 2) + '\n',
    `chore(agent-inbox): processed ${syncId}`,
  )
  return body
}

export async function testGithubAuth() {
  const cfg = loadSyncConfig()
  if (!hasGithubAuth(cfg)) throw new Error('请先填写 Token / 仓库')
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `仓库不可用 (${res.status})`)
  }
  const data = await res.json()
  return { fullName: data.full_name, private: data.private, defaultBranch: data.default_branch }
}
