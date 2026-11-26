const KEY = 'interview-review-feedback-v1'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { notes: [] }
    const parsed = JSON.parse(raw)
    return { notes: Array.isArray(parsed.notes) ? parsed.notes : [] }
  } catch {
    return { notes: [] }
  }
}

function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state))
}

export function listNotes() {
  return load().notes.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

export function notesFor(targetId) {
  return listNotes().filter((n) => n.targetId === targetId && n.status !== 'done')
}

export function openNoteCount() {
  return listNotes().filter((n) => n.status !== 'done').length
}

/** kind: unclear | fix | expand */
export function upsertNote({ targetId, targetType, title, module, kind, text, section }) {
  const state = load()
  const now = Date.now()
  const existing = state.notes.find(
    (n) => n.targetId === targetId && n.status !== 'done' && (n.section || '') === (section || ''),
  )
  if (existing) {
    existing.text = String(text || '').trim()
    existing.kind = kind || existing.kind
    existing.updatedAt = now
    existing.title = title || existing.title
    existing.module = module || existing.module
  } else {
    state.notes.push({
      id: `fb-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      targetId,
      targetType: targetType || 'knowledge',
      title: title || targetId,
      module: module || '',
      kind: kind || 'unclear',
      section: section || '',
      text: String(text || '').trim(),
      status: 'open',
      createdAt: now,
      updatedAt: now,
    })
  }
  save(state)
  return state.notes
}

export function markNoteDone(id) {
  const state = load()
  const n = state.notes.find((x) => x.id === id)
  if (n) {
    n.status = 'done'
    n.updatedAt = Date.now()
    save(state)
  }
}

export function removeNote(id) {
  const state = load()
  state.notes = state.notes.filter((x) => x.id !== id)
  save(state)
}

/** 复制给 Cursor Agent 的批量补充提示 */
export function buildAgentPrompt(notes = listNotes().filter((n) => n.status !== 'done')) {
  if (!notes.length) return '（当前没有待补充的反馈）'
  const lines = [
    '请根据下面的学习反馈，批量补充/改写面试复习题库。',
    '',
    '规则：',
    '1. 优先改 `interview-review/review-content/_full/` 对应知识点，再执行 `node scripts/apply-full-knowledge.mjs && npm run content`。',
    '2. 知识点标题保持主题名（非问句）；问答才用提问形式。',
    '3. 针对「不懂」处：用更白话重写该段原理，并加一个最小例子；必要时补术语到 glossary.yaml。',
    '4. 改完后把相关 frontmatter 的 version +1。',
    '5. 改完后告诉我改了哪些 id。',
    '',
    '反馈列表：',
  ]
  notes.forEach((n, i) => {
    const kindLabel = { unclear: '不懂/要解释', fix: '内容有误', expand: '要加深' }[n.kind] || n.kind
    lines.push(`${i + 1}. [${kindLabel}] ${n.title} (id=${n.targetId}${n.section ? `, 章节=${n.section}` : ''})`)
    lines.push(`   模块: ${n.module || '-'}`)
    lines.push(`   用户说: ${n.text || '（未写具体疑问，请整体讲更清楚）'}`)
    lines.push('')
  })
  return lines.join('\n')
}
