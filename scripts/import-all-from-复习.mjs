/**
 * 从 ../复习 导入全部问答与专题，生成详细知识点 + 问答。
 * 运行：node scripts/import-all-from-复习.mjs && npm run content
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const reviewRoot = path.resolve(root, '..', '复习')
const outRoot = path.join(root, 'review-content')

function slug(s) {
  return String(s)
    .replace(/[`'"「」【】]/g, '')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9+_./-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'item'
}

function shortHash(s) {
  return createHash('md5').update(s).digest('hex').slice(0, 6)
}

function write(rel, text) {
  const p = path.join(outRoot, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text.trimStart())
}

function read(rel) {
  return fs.readFileSync(path.join(reviewRoot, rel), 'utf8')
}

function parsePriority(title) {
  const m = title.match(/·\s*(P[012])\s*$/)
  return m ? m[1] : 'P1'
}

function cleanTitle(title) {
  return title.replace(/\s*·\s*P[012]\s*$/, '').trim()
}

/** 从「### Qxx. 标题」切问答 */
function extractQAs(md) {
  const parts = md.split(/\n(?=###\s+Q\d+[a-z]?\.)/)
  const items = []
  for (const part of parts) {
    const m = part.match(/^###\s+(Q\d+[a-z]?)\.\s*(.+?)\s*\n([\s\S]*)$/)
    if (!m) continue
    const qid = m[1]
    const rawTitle = m[2].trim()
    const priority = parsePriority(rawTitle)
    const title = cleanTitle(rawTitle)
    let body = m[3]
    // 去掉 **A：** 前缀
    body = body.replace(/^\*\*A[：:]\*\*\s*/m, '').trim()
    // 截到下一个大节前（已按 ### Q 切）
    items.push({ qid, title, priority, answer: body })
  }
  return items
}

/** 按 ## 切知识点章节（详细专题） */
function extractSections(md) {
  const lines = md.split(/\n/)
  const sections = []
  let cur = null
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)\s*$/)
    if (m) {
      if (cur) sections.push(cur)
      cur = { title: m[1].replace(/^\d+\.\s*/, '').trim(), body: [] }
      continue
    }
    if (cur) cur.body.push(line)
  }
  if (cur) sections.push(cur)
  return sections
    .map((s) => ({ title: s.title, body: s.body.join('\n').trim() }))
    .filter((s) => s.body.length > 80 && !/自测|总览|怎么复习|口述 1 分钟|建议学习/.test(s.title))
}

function firstSentence(text) {
  const t = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, '…')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const m = t.match(/([^。！？]{8,100}[。！？])/)
  return m ? m[1].trim() : t.slice(0, 60)
}

function wrapKnowledge(title, body) {
  let raw = body.trim()
  if (/^##\s*一句话/m.test(raw)) return raw

  const codeBlocks = [...raw.matchAll(/```[\s\S]*?```/g)].map((m) => m[0])
  const tables = [...raw.matchAll(/(?:^\|.+\|$\n?)+/gm)].map((m) => m[0].trim())
  const one = firstSentence(raw.replace(/```[\s\S]*?```/g, ' ').replace(/\|/g, ' '))

  let out = `## 一句话\n\n${one || title}\n\n## 详细说明\n\n${raw}\n`

  out += `\n## 例子\n\n`
  if (codeBlocks.length) {
    out += `下面把原文中的关键代码单独拎出来，方便对照：\n\n`
    out += codeBlocks.slice(0, 3).join('\n\n') + '\n'
  } else if (tables.length) {
    out += `用原文表格对照理解：\n\n${tables[0]}\n`
  } else {
    out += `口述时请补一个最小例子：先说输入/场景，再说调用了哪个 API 或走了哪条链路，最后说结果和坑。\n\n`
    out += `例如结合本题「${title}」：先讲正常路径，再讲失败/边界路径。\n`
  }

  out += `\n## 画面\n\n\`\`\`text\n`
  if (/挂起|阻塞|协程/.test(title + raw)) {
    out += `线程(工人) ──跑──▶ 协程(工单)\n工单遇到挂起 ──让出工人──▶ 其它工单\n阻塞则工人干等，别人用不了\n`
  } else if (/Handler|Looper|Message/.test(title + raw)) {
    out += `线程 → Looper.loop()\n        ↓\n   MessageQueue.next()\n        ↓\n   Handler.dispatchMessage()\n`
  } else if (/握手|TCP|HTTPS|证书/.test(title + raw)) {
    out += `客户端                服务端\n   |---- SYN --------→|\n   |←-- SYN+ACK ------|\n   |---- ACK --------→|\n`
  } else if (/MVI|MVVM|Intent|State/.test(title + raw)) {
    out += `UI 事件/Intent → ViewModel → 新 State → UI 重组\n一次性动作走 Effect（Toast/跳转），不要塞进 State\n`
  } else if (/组件化|路由|架构/.test(title + raw)) {
    out += `app → 业务组件 → 中间件/SDK → 基础库\n依赖只向下；跳转走路由表 + 拦截器\n`
  } else {
    out += `${title}\n  ├─ 是什么\n  ├─ 关键步骤/结构\n  └─ 坑与选型\n`
  }
  out += `\`\`\`\n`
  return out
}

const MODULES = [
  { id: 'project', name: '项目口述', order: 0 },
  { id: 'coroutine', name: '协程', order: 1 },
  { id: 'concurrent', name: '并发', order: 2 },
  { id: 'jvm', name: 'JVM', order: 3 },
  { id: 'language', name: '语言', order: 4 },
  { id: 'android', name: 'Android', order: 5 },
  { id: 'network', name: '网络', order: 6 },
  { id: 'architecture', name: '架构', order: 7 },
  { id: 'compose', name: 'Compose', order: 8 },
  { id: 'framework', name: '三方框架', order: 9 },
  { id: 'agent', name: 'Agent', order: 10 },
  { id: 'algo', name: '算法', order: 90 },
]

// 清空旧内容（保留目录结构）
for (const dir of fs.readdirSync(outRoot)) {
  const p = path.join(outRoot, dir)
  if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true })
}

write(
  'modules.yaml',
  MODULES.map((m) => `- id: ${m.id}\n  name: ${m.name}\n  order: ${m.order}`).join('\n') + '\n',
)

const jobs = [
  // 问答型：每题 → 详细知识点 + 问答（正文用完整答案）
  { file: '协程与并发.md', module: 'coroutine', folder: '协程', asQA: true, asKP: false },
  { file: '第1天-基础与主线项目.md', module: 'coroutine', folder: '协程', asQA: true, asKP: false, preferLonger: true },
  { file: '基础知识/01-语言与JVM.md', module: 'language', folder: '语言', asQA: true, asKP: false },
  { file: '基础知识/02-Android基础.md', module: 'android', folder: 'Android', asQA: true, asKP: false },
  { file: '基础知识/03-网络.md', module: 'network', folder: '网络', asQA: true, asKP: false },
  { file: '基础知识/04-架构.md', module: 'architecture', folder: '架构', asQA: true, asKP: false },
  { file: '基础知识/05-常用组件框架.md', module: 'framework', folder: '三方框架', asQA: true, asKP: false },
  { file: '基础知识/06-Compose.md', module: 'compose', folder: 'Compose', asQA: true, asKP: false },
  // 专题长文：按 ## 切成详细知识点
  { file: 'Java线程与并发.md', module: 'concurrent', folder: '并发', asQA: false, asKP: true },
  { file: 'JVM与并发原理.md', module: 'jvm', folder: 'JVM', asQA: false, asKP: true },
  { file: '语言-Kotlin与Java.md', module: 'language', folder: '语言', asQA: false, asKP: true },
  { file: '语言-混编详解.md', module: 'language', folder: '语言', asQA: false, asKP: true },
  { file: 'Agent与AICoding.md', module: 'agent', folder: 'Agent', asQA: false, asKP: true },
  { file: '市场补充-架构工具三方.md', module: 'framework', folder: '三方框架', asQA: false, asKP: true },
]

let qaCount = 0
let kpCount = 0
const usedIds = new Set()
/** titleKey -> { kpid, answerLen, qaPath, kpPath, module, folder, priority, title } */
const qaByTitle = new Map()

function uniqueId(prefix, title) {
  let id = `${prefix}-${slug(title)}`
  if (id.length > 60) id = `${prefix}-${shortHash(title)}-${slug(title).slice(0, 24)}`
  if (usedIds.has(id)) id = `${id}-${shortHash(id + usedIds.size)}`
  usedIds.add(id)
  return id
}

function titleKey(t) {
  return t.replace(/[`\s]/g, '').toLowerCase()
}

for (const job of jobs) {
  const md = read(job.file)
  if (job.asQA) {
    const qas = extractQAs(md)
    for (const q of qas) {
      let module = job.module
      let folder = job.folder
      if (job.file.includes('第1天')) {
        if (/^Q(1[0-4])$/.test(q.qid) || /synchronized|线程池|HashMap|死锁|volatile|sleep|wait|ConcurrentHashMap/.test(q.title)) {
          module = 'concurrent'
          folder = '并发'
        } else if (/^Q(1[5-9])$/.test(q.qid) || /Handler|启动|生命周期|ANR|事件|Service/.test(q.title)) {
          module = 'android'
          folder = 'Android'
        } else if (/^Q2[0-3]$/.test(q.qid) || /空安全|sealed|扩展|suspend|Java|data class|enum/.test(q.title)) {
          module = 'language'
          folder = '语言'
        } else {
          module = 'coroutine'
          folder = '协程'
        }
      }

      const key = titleKey(q.title)
      const prev = qaByTitle.get(key)
      // 同名题保留更长答案（第1天细稿优先覆盖短答）
      if (prev && prev.answerLen >= q.answer.length && !job.preferLonger) continue
      if (prev && job.preferLonger && prev.answerLen > q.answer.length) continue

      let kpid = prev?.kpid || uniqueId('kp', q.title)
      let qid = prev?.qid || uniqueId('q', `${q.qid}-${q.title}`)
      if (!prev) {
        usedIds.add(kpid)
        usedIds.add(qid)
      }

      const kpBodyExtra = wrapKnowledge(q.title, q.answer)
      const priority = job.file.includes('第1天') ? 'P0' : q.priority
      write(
        `${folder}/${kpid}.md`,
        `---
id: ${kpid}
type: knowledge
module: ${module}
title: ${q.title.replace(/"/g, "'")}
priority: ${priority}
version: 1
---

${kpBodyExtra}
`,
      )
      write(
        `${folder}/${qid}.md`,
        `---
id: ${qid}
type: qa
module: ${module}
knowledge_ref: ${kpid}
title: ${q.title.replace(/"/g, "'").slice(0, 40)}
priority: ${priority}
version: 1
---

## 问题
${q.title}

## 答案
${q.answer}
`,
      )
      if (!prev) {
        kpCount++
        qaCount++
      }
      qaByTitle.set(key, {
        kpid,
        qid,
        answerLen: q.answer.length,
        module,
        folder,
        priority: q.priority,
        title: q.title,
      })
    }
  }

  if (job.asKP) {
    const sections = extractSections(md)
    for (const sec of sections) {
      if (sec.body.length < 100) continue
      const id = uniqueId('kp', `${job.module}-${sec.title}`)
      write(
        `${job.folder}/${id}.md`,
        `---
id: ${id}
type: knowledge
module: ${job.module}
title: ${sec.title.replace(/"/g, "'")}
priority: P0
version: 1
---

${wrapKnowledge(sec.title, sec.body)}
`,
      )
      kpCount++
    }
  }
}

// —— 项目重点：按公司章节做详细知识点 + 问答 ——
{
  const md = read('项目重点.md')
  const blocks = md.split(/\n(?=##\s+[A-Z]\.)/)
  for (const block of blocks) {
    const hm = block.match(/^##\s+([A-Z])\.\s*(.+)\s*$/m)
    if (!hm) continue
    const title = hm[2].replace(/\s*·\s*P[01]\s*$/, '').trim()
    const id = uniqueId('kp', `project-${title}`)
    write(
      `项目/${id}.md`,
      `---
id: ${id}
type: knowledge
module: project
title: ${title.replace(/"/g, "'")}
priority: ${/P0/.test(hm[2]) ? 'P0' : 'P1'}
version: 1
---

${wrapKnowledge(title, block.replace(/^##.+\n/, ''))}
`,
    )
    kpCount++

    // 从表格「可能问到的点」抽问答
    const tableRows = [...block.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm)]
    for (const row of tableRows) {
      const q = row[1].trim()
      const a = row[2].trim()
      if (!q || /问题|—|---|重点条目/.test(q) || q.length < 4) continue
      if (a.length < 4) continue
      const qid = uniqueId('q', `project-${q}`)
      write(
        `项目/${qid}.md`,
        `---
id: ${qid}
type: qa
module: project
knowledge_ref: ${id}
title: ${q.replace(/"/g, "'").slice(0, 40)}
priority: P0
version: 1
---

## 问题
${q}

## 答案
${a}

（展开口述时结合该项目章节的「一句话 / 提纲 / 数字清单」。）
`,
      )
      qaCount++
    }
  }
}

// —— 算法：导入必刷题 ——
{
  const md = read('基础算法.md')
  const rows = [...md.matchAll(/^\|\s*(必刷|次刷|选刷)\s*\|\s*\*\*?(\d+)\*\*?\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|$/gm)]
  for (const row of rows) {
    const level = row[1]
    const no = row[2]
    const title = row[3].trim()
    const tip = row[4].trim()
    if (level === '选刷') continue
    const id = `algo-${no}`
    usedIds.add(id)
    write(
      `算法/lc-${no}.md`,
      `---
id: ${id}
type: algo
module: algo
title: ${title.replace(/"/g, "'")}
leetcode: ${no}
priority: ${level === '必刷' ? 'P0' : 'P1'}
version: 1
tags: ["算法"]
---

## 题目
力扣 ${no}：${title}

考点：${tip || '见题解'}

## 答案
思路要点：${tip || '先写模板再处理边界。'}

详细步骤：
1. 识别题型（双指针 / 滑动窗口 / 链表 / 栈 / 二分 / 树 / 堆 / DP）。
2. 先写暴力或模板骨架，再压到目标复杂度。
3. 自测空输入、单元素、已有序/逆序、重复元素。
4. 口述：时间复杂度、空间复杂度、易错点。

建议：限时 25–40 分钟手写，对完题解把「卡点」记进错题本。
`,
    )
  }
}

// —— glossary ——
write(
  'glossary.yaml',
  `
- word: Dispatcher
  phonetic: /dɪˈspætʃə/
  meaning: 协程调度器，决定协程在哪类线程执行（Main/IO/Default）。
- word: Continuation
  phonetic: /kənˌtɪnjuˈeɪʃn/
  meaning: 续体，挂起时保存的后续执行状态。
- word: StateFlow
  phonetic: —
  meaning: 带当前值的热流，适合 UI 状态；相同值默认不重复通知。
- word: SharedFlow
  phonetic: —
  meaning: 可配置 replay/缓冲的热流，常用于事件广播。
- word: Mutex
  phonetic: /ˈmjuːteks/
  meaning: 协程互斥锁，挂起等待且默认不可重入。
- word: Semaphore
  phonetic: /ˈseməfɔː/
  meaning: 信号量，用许可数限制并发。
- word: Handler
  phonetic: /ˈhændlə/
  meaning: Android 消息处理者，把任务投递到绑定 Looper 的线程。
- word: Looper
  phonetic: /ˈluːpə/
  meaning: 线程消息循环，不断从 MessageQueue 取消息。
- word: ANR
  phonetic: —
  meaning: Application Not Responding，主线程长时间未完成必要工作。
- word: volatile
  phonetic: /ˈvɒlətaɪl/
  meaning: 保证可见性与有序性，不保证复合操作原子性。
- word: ReentrantLock
  phonetic: —
  meaning: 可重入锁，支持公平/非公平、tryLock、Condition。
- word: CAS
  phonetic: —
  meaning: Compare-And-Swap，无锁原子更新；注意 ABA 问题。
- word: QUIC
  phonetic: /kwɪk/
  meaning: 基于 UDP 的传输协议，HTTP/3 的基础，降低握手时延。
- word: OkHttp
  phonetic: —
  meaning: Android 主流 HTTP 客户端，拦截器链与连接池是面试重点。
- word: Compose
  phonetic: —
  meaning: Jetpack 声明式 UI；状态变化触发重组。
- word: Hilt
  phonetic: —
  meaning: 基于 Dagger 的官方 DI，编译期生成。
- word: SEI
  phonetic: —
  meaning: 补充增强信息，常用于 RTC 音画/课件同步。
- word: RTC
  phonetic: —
  meaning: 实时音视频；底座常用适配层对接不同厂商。
- word: MCP
  phonetic: —
  meaning: Model Context Protocol，给 Agent 接外部工具的协议。
- word: WorkManager
  phonetic: —
  meaning: 可延迟且尽量保证执行的后台任务框架，适合离开页面也要完成的工作。
`,
)

console.log(`imported kp≈${kpCount} qa≈${qaCount} (algo from table separate)`)
console.log('next: npm run content')
