import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const contentRoot = path.join(root, 'review-content')
const outFile = path.join(root, 'public', 'content-pack.json')

function parseYamlList(text) {
  // Minimal YAML list parser for our simple glossary/modules files
  const items = []
  let cur = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, '  ')
    if (!line.trim() || line.trim().startsWith('#')) continue
    const start = line.match(/^- (.+)$/)
    if (start) {
      if (cur) items.push(cur)
      const rest = start[1].trim()
      if (rest.includes(':')) {
        cur = {}
        const [k, ...vs] = rest.split(':')
        cur[k.trim()] = vs.join(':').trim().replace(/^["']|["']$/g, '')
      } else {
        cur = { value: rest }
      }
      continue
    }
    const kv = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/)
    if (kv && cur) {
      cur[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  if (cur) items.push(cur)
  return items
}

function parseFrontMatter(raw) {
  if (!raw.startsWith('---')) {
    return { data: {}, body: raw }
  }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { data: {}, body: raw }
  const fm = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).replace(/^\r?\n/, '')
  const data = {}
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else if (/^\d+$/.test(v)) {
      v = Number(v)
    } else {
      v = v.replace(/^["']|["']$/g, '')
    }
    data[m[1]] = v
  }
  return { data, body }
}

function splitQa(body) {
  const q = body.match(/##\s*问题\s*\n([\s\S]*?)(?=\n##\s*答案|$)/)
  const a = body.match(/##\s*答案\s*\n([\s\S]*)$/)
  return {
    question: (q?.[1] || '').trim(),
    answer: (a?.[1] || '').trim(),
  }
}

function splitAlgo(body) {
  const t = body.match(/##\s*题目\s*\n([\s\S]*?)(?=\n##\s*答案|$)/)
  const a = body.match(/##\s*答案\s*\n([\s\S]*)$/)
  return {
    problem: (t?.[1] || body).trim(),
    answer: (a?.[1] || '').trim(),
  }
}

function walkMd(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const name of fs.readdirSync(dir)) {
    // 跳过草稿/源稿目录（如 _full），避免知识点被打两遍
    if (name.startsWith('_') || name === 'node_modules') continue
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walkMd(p, files)
    else if (name.endsWith('.md')) files.push(p)
  }
  return files
}

const modules = parseYamlList(fs.readFileSync(path.join(contentRoot, 'modules.yaml'), 'utf8'))
const glossary = parseYamlList(fs.readFileSync(path.join(contentRoot, 'glossary.yaml'), 'utf8'))

const knowledge = []
const qa = []
const algo = []

for (const file of walkMd(contentRoot)) {
  const raw = fs.readFileSync(file, 'utf8')
  const { data, body } = parseFrontMatter(raw)
  if (!data.id || !data.type) {
    console.warn('skip (missing id/type):', path.relative(root, file))
    continue
  }
  const base = {
    id: data.id,
    type: data.type,
    module: data.module,
    title: data.title || data.id,
    priority: data.priority || 'P1',
    version: Number(data.version || 1),
    knowledge_ref: data.knowledge_ref || null,
    source: path.relative(contentRoot, file),
  }
  if (data.type === 'knowledge') {
    knowledge.push({ ...base, body })
  } else if (data.type === 'qa') {
    const { question, answer } = splitQa(body)
    qa.push({ ...base, question, answer })
  } else if (data.type === 'algo') {
    const { problem, answer } = splitAlgo(body)
    algo.push({
      ...base,
      leetcode: data.leetcode || '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      problem,
      answer,
    })
  }
}

const pack = {
  contentRevision: Date.now(),
  generatedAt: new Date().toISOString(),
  modules,
  glossary,
  knowledge,
  qa,
  algo,
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(pack, null, 2))
console.log(
  `content-pack: modules=${modules.length} kp=${knowledge.length} qa=${qa.length} algo=${algo.length} → public/content-pack.json`,
)
