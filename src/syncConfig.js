const KEY = 'interview-review-sync-config-v1'

export const DEFAULT_SYNC_CONFIG = {
  owner: 'ls0822',
  repo: 'interview-review',
  branch: 'main',
  token: '',
  autoUploadOnMark: false,
  paths: {
    latestMd: 'agent-inbox/latest.md',
    latestJson: 'agent-inbox/latest.json',
    processed: 'agent-inbox/processed.json',
  },
}

export function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SYNC_CONFIG, paths: { ...DEFAULT_SYNC_CONFIG.paths } }
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_SYNC_CONFIG,
      ...parsed,
      paths: { ...DEFAULT_SYNC_CONFIG.paths, ...(parsed.paths || {}) },
      token: typeof parsed.token === 'string' ? parsed.token : '',
    }
  } catch {
    return { ...DEFAULT_SYNC_CONFIG, paths: { ...DEFAULT_SYNC_CONFIG.paths } }
  }
}

export function saveSyncConfig(partial) {
  const next = {
    ...loadSyncConfig(),
    ...partial,
    paths: {
      ...DEFAULT_SYNC_CONFIG.paths,
      ...(partial.paths || loadSyncConfig().paths),
    },
  }
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function clearSyncToken() {
  const cfg = loadSyncConfig()
  cfg.token = ''
  localStorage.setItem(KEY, JSON.stringify(cfg))
  return cfg
}

export function hasGithubAuth(cfg = loadSyncConfig()) {
  return Boolean(cfg.token && cfg.owner && cfg.repo && cfg.branch)
}

export function rawUrl(cfg, filePath) {
  const path = String(filePath || '').replace(/^\/+/, '')
  return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${path}`
}

export function buildSourceJson(cfg = loadSyncConfig()) {
  return {
    owner: cfg.owner,
    repo: cfg.repo,
    branch: cfg.branch,
    paths: { ...cfg.paths },
    latestMdUrl: rawUrl(cfg, cfg.paths.latestMd),
    latestJsonUrl: rawUrl(cfg, cfg.paths.latestJson),
    processedUrl: rawUrl(cfg, cfg.paths.processed),
    note: 'Agent 拉取标注：先读本文件 URL，再取 latest.md / latest.json；处理完后把 syncId 写入 processed.json',
  }
}
