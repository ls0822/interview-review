#!/usr/bin/env node
/**
 * 结构校验：knowledge 七段、标题问句、必填 frontmatter、_full 与模块副本一致性（有 full 时）
 * 用法: node scripts/validate-content.mjs
 * exit 1 = 有 error（warning 不失败）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contentRoot = path.join(root, 'review-content')
const fullRoot = path.join(contentRoot, '_full')

const KP_SECTIONS = ['一句话', '组成与结构', '原理', '使用与实践', '例子', '画面', '常见坑']
const QUESTIONISH = /[？?]$|^(什么是|如何|怎么|为何|为什么|怎样|是否|能否|可以吗)/

const errors = []
const warnings = []

function parseFrontMatter(raw) {
  if (!raw.startsWith('---')) return { data: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { data: {}, body: raw }
  const fm = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).replace(/^\r?\n/, '')
  const data = {}
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim().replace(/^["']|["']$/g, '')
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else if (/^\d+$/.test(v)) v = Number(v)
    data[m[1]] = v
  }
  return { data, body }
}

function walkMd(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (name === '_full') continue
      walkMd(p, acc)
    } else if (name.endsWith('.md') && !['CONTENT_SPEC.md', 'CONTENT_BOUNDARY.md', 'modules.yaml'].includes(name)) {
      acc.push(p)
    }
  }
  return acc
}

function rel(p) {
  return path.relative(root, p)
}

const files = walkMd(contentRoot)
const ids = new Map()

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8')
  const { data, body } = parseFrontMatter(raw)
  const where = rel(file)

  if (!data.id) errors.push(`${where}: 缺少 id`)
  if (!data.type) errors.push(`${where}: 缺少 type`)
  if (!data.title) errors.push(`${where}: 缺少 title`)
  if (data.version == null) warnings.push(`${where}: 缺少 version`)

  if (data.id) {
    if (ids.has(data.id)) errors.push(`${where}: id 重复 ${data.id}（亦见于 ${ids.get(data.id)}）`)
    else ids.set(data.id, where)
  }

  if (data.type === 'knowledge') {
    const title = String(data.title || '')
    if (QUESTIONISH.test(title.trim())) {
      errors.push(`${where}: knowledge 标题疑似问句「${title}」`)
    }
    for (const h of KP_SECTIONS) {
      if (!body.includes(h) && !(h === '常见坑' && body.includes('常见坑与追问'))) {
        errors.push(`${where}: 缺章节「${h}」`)
      }
    }
    if (data.requires) {
      const reqs = Array.isArray(data.requires) ? data.requires : [data.requires]
      for (const r of reqs) {
        if (r && !String(r).startsWith('kp-') && !String(r).startsWith('q-')) {
          warnings.push(`${where}: requires 项异常 ${r}`)
        }
      }
    }
  }

  if (data.type === 'qa') {
    if (!/##\s*问题/.test(body)) errors.push(`${where}: qa 缺「## 问题」`)
    if (!/##\s*答案/.test(body)) errors.push(`${where}: qa 缺「## 答案」`)
  }

  if (data.type === 'algo') {
    if (!/##\s*题目/.test(body)) errors.push(`${where}: algo 缺「## 题目」`)
    if (!/##\s*答案/.test(body)) errors.push(`${where}: algo 缺「## 答案」`)
  }
}

// _full 与模块副本：有 full 则模块文件应与 full 正文一致（忽略尾空白）
if (fs.existsSync(fullRoot)) {
  for (const name of fs.readdirSync(fullRoot)) {
    if (!name.endsWith('.md')) continue
    const fullPath = path.join(fullRoot, name)
    const raw = fs.readFileSync(fullPath, 'utf8')
    const { data } = parseFrontMatter(raw)
    if (data.type !== 'knowledge' || !data.id || !data.module) continue
    const modFolder = {
      project: '项目',
      coroutine: '协程',
      concurrent: '并发',
      jvm: 'JVM',
      language: '语言',
      android: 'Android',
      network: '网络',
      architecture: '架构',
      compose: 'Compose',
      framework: '三方框架',
      agent: 'Agent',
      algo: '算法',
    }[data.module]
    if (!modFolder) {
      warnings.push(`_full/${name}: 未知 module ${data.module}`)
      continue
    }
    const dest = path.join(contentRoot, modFolder, `${data.id}.md`)
    if (!fs.existsSync(dest)) {
      errors.push(`_full/${name}: 模块副本缺失 ${rel(dest)}（请 apply-full）`)
      continue
    }
    const a = raw.replace(/\s+$/, '')
    const b = fs.readFileSync(dest, 'utf8').replace(/\s+$/, '')
    if (a !== b) {
      errors.push(`_full/${name}: 与模块副本不一致 ${rel(dest)}（请 apply-full）`)
    }
    for (const h of KP_SECTIONS) {
      if (!raw.includes(h) && !(h === '常见坑' && raw.includes('常见坑与追问'))) {
        errors.push(`_full/${name}: 缺章节「${h}」`)
      }
    }
    if (QUESTIONISH.test(String(data.title || '').trim())) {
      errors.push(`_full/${name}: knowledge 标题疑似问句`)
    }
  }
}

console.log(`validate-content: scanned ${files.length} module md files`)
if (warnings.length) {
  console.log(`\nWarnings (${warnings.length}):`)
  warnings.slice(0, 80).forEach((w) => console.log('  W', w))
  if (warnings.length > 80) console.log(`  ... +${warnings.length - 80} more`)
}
if (errors.length) {
  console.log(`\nErrors (${errors.length}):`)
  errors.slice(0, 120).forEach((e) => console.log('  E', e))
  if (errors.length > 120) console.log(`  ... +${errors.length - 120} more`)
  process.exit(1)
}
console.log('\nOK: no structural errors')
