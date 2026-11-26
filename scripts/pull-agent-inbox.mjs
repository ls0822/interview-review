#!/usr/bin/env node
/**
 * Agent / 本机拉取远端学习标注。
 * 用法: node scripts/pull-agent-inbox.mjs
 * 读取 agent-inbox/source.json → 下载 latest.md / latest.json / processed.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const inbox = path.join(root, 'agent-inbox')
const sourcePath = path.join(inbox, 'source.json')

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
const stamp = Date.now()

async function pull(label, url, dest) {
  if (!url) {
    console.log(`skip ${label}: no url`)
    return null
  }
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${stamp}`)
  if (!res.ok) {
    console.log(`fail ${label}: HTTP ${res.status}`)
    return null
  }
  const text = await res.text()
  fs.writeFileSync(dest, text.endsWith('\n') ? text : text + '\n', 'utf8')
  console.log(`ok   ${label} → ${path.relative(root, dest)} (${text.length} bytes)`)
  return text
}

fs.mkdirSync(inbox, { recursive: true })
await pull('latest.md', source.latestMdUrl, path.join(inbox, 'latest.md'))
const jsonText = await pull('latest.json', source.latestJsonUrl, path.join(inbox, 'latest.json'))
await pull('processed.json', source.processedUrl, path.join(inbox, 'processed.json'))

if (jsonText) {
  try {
    const env = JSON.parse(jsonText)
    const processed = JSON.parse(fs.readFileSync(path.join(inbox, 'processed.json'), 'utf8'))
    const done = new Set((processed.processed || []).map((x) => x.syncId))
    if (!env.syncId) console.log('status: empty (no syncId)')
    else if (done.has(env.syncId)) console.log(`status: already processed (${env.syncId})`)
    else console.log(`status: PENDING → ${env.syncId} (${env.status || 'pending'})`)
  } catch (e) {
    console.log('parse warning:', e.message)
  }
}
