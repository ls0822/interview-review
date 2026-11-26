import { marked } from 'marked'

marked.setOptions({ breaks: true })

const WORD_RE = /\b([A-Za-z][A-Za-z0-9_+]*(?:\.[A-Za-z][A-Za-z0-9_+]*)*)\b/g

/** 章节标题 → 界面展示名（内容里仍可写「画面」） */
export const SECTION_LABELS = {
  一句话: { label: '一句话', hint: '先抓住本质' },
  组成与结构: { label: '组成与结构', hint: '有哪些零件' },
  原理: { label: '原理', hint: '为什么这样跑' },
  使用与实践: { label: '使用与实践', hint: '项目里怎么用' },
  例子: { label: '例子', hint: '最小可跑通' },
  画面: { label: '结构示意', hint: '脑内建模用的示意图，不是插图库' },
  结构示意: { label: '结构示意', hint: '脑内建模用的示意图' },
  常见坑与追问: { label: '常见坑与追问', hint: '面试容易卡的地方' },
  常见坑: { label: '常见坑与追问', hint: '面试容易卡的地方' },
}

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function renderMarkdown(md, glossaryMap) {
  const html = marked.parse(md || '')
  return linkifyEnglish(html, glossaryMap)
}

/** 按 ## 切成卡片，便于阅读；「画面」显示为「结构示意」 */
export function renderKnowledgeSections(md, glossaryMap, sectionMastery = {}) {
  const text = String(md || '').trim()
  if (!text) return '<p class="muted">暂无正文</p>'
  const parts = text.split(/\n(?=##\s+)/)
  const blocks = []
  for (const part of parts) {
    const m = part.match(/^##\s+(.+?)\s*\n([\s\S]*)$/) || part.match(/^##\s+(.+?)\s*$/)
    if (!m) {
      blocks.push(`<div class="kp-section"><div class="markdown">${renderMarkdown(part, glossaryMap)}</div></div>`)
      continue
    }
    const rawTitle = m[1].trim()
    const body = (m[2] || '').trim()
    const meta = SECTION_LABELS[rawTitle] || { label: rawTitle, hint: '' }
    const sectionKey = escapeHtml(rawTitle)
    const mastery = sectionMastery[rawTitle] || ''
    const knownOn = mastery === 'known' ? 'on' : ''
    const unclearOn = mastery === 'unclear' ? 'on' : ''
    const badge =
      mastery === 'known'
        ? '<span class="tag good">已明白</span>'
        : mastery === 'unclear'
          ? '<span class="tag bad">待搞懂</span>'
          : ''
    blocks.push(`
      <section class="kp-section ${mastery === 'known' ? 'is-known' : mastery === 'unclear' ? 'is-unclear' : ''}" data-section="${sectionKey}">
        <header class="kp-section-head">
          <div>
            <h2>${escapeHtml(meta.label)} ${badge}</h2>
            ${meta.hint ? `<p class="kp-section-hint">${escapeHtml(meta.hint)}</p>` : ''}
          </div>
          <div class="row section-actions">
            <button type="button" class="ghost ${knownOn}" data-action="section-known" data-section="${sectionKey}">这节明白</button>
            <button type="button" class="ghost ${unclearOn}" data-action="feedback-section" data-section="${sectionKey}">这节不懂</button>
          </div>
        </header>
        <div class="markdown">${renderMarkdown(body, glossaryMap)}</div>
      </section>`)
  }
  return blocks.join('')
}

function linkifyEnglish(html, glossaryMap) {
  // Avoid replacing inside tags / code
  const parts = html.split(/(<[^>]+>)/g)
  return parts
    .map((part) => {
      if (part.startsWith('<')) return part
      return part.replace(WORD_RE, (word) => {
        if (word.length < 2) return word
        const hit = glossaryMap.get(word) || glossaryMap.get(word.toLowerCase())
        if (!hit && !/[A-Z]/.test(word[0]) && word.length < 4) return word
        // Always allow glossary hits; also allow CamelCase / ALLCAPS tech tokens
        const tech = hit || /^[A-Z]/.test(word) || word.includes('_')
        if (!tech) return word
        const key = hit ? hit.word : word
        return `<span class="word" data-word="${escapeHtml(key)}" title="长按或点击查看释义">${escapeHtml(word)}</span>`
      })
    })
    .join('')
}

export function buildGlossaryMap(list) {
  const map = new Map()
  for (const g of list || []) {
    if (!g.word) continue
    map.set(g.word, g)
    map.set(g.word.toLowerCase(), g)
  }
  return map
}
