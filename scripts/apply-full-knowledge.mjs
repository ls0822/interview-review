/**
 * 用 review-content/_full 的完整深度知识点重建题库，
 * 并重新导入问答 / 算法（知识点标题保持主题名，问答保持提问形式）。
 *
 * node scripts/apply-full-knowledge.mjs && npm run content
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const reviewRoot = path.resolve(root, '..', '复习')
const outRoot = path.join(root, 'review-content')
const fullRoot = path.join(outRoot, '_full')

function readReview(rel) {
  return fs.readFileSync(path.join(reviewRoot, rel), 'utf8')
}
function write(rel, text) {
  const p = path.join(outRoot, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text.trimStart())
}
function hash(s) {
  return createHash('md5').update(s).digest('hex').slice(0, 8)
}

const FOLDER = {
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
}

const MODULES = [
  ['project', '项目口述', 0],
  ['coroutine', '协程', 1],
  ['concurrent', '并发', 2],
  ['jvm', 'JVM', 3],
  ['language', '语言', 4],
  ['android', 'Android', 5],
  ['network', '网络', 6],
  ['architecture', '架构', 7],
  ['compose', 'Compose', 8],
  ['framework', '三方框架', 9],
  ['agent', 'Agent', 10],
  ['algo', '算法', 90],
]

/** 具名问答（非 hash 八位）：清空模块目录前备份，结束后写回，避免被冲掉 */
function isCuratedQaFile(name) {
  return /^q-(?![\da-f]{8}\.md$)[a-z][\w-]*\.md$/i.test(name)
}
const curatedQa = []
for (const name of fs.readdirSync(outRoot)) {
  const dir = path.join(outRoot, name)
  if (!fs.statSync(dir).isDirectory() || name === '_full') continue
  for (const f of fs.readdirSync(dir)) {
    if (!isCuratedQaFile(f)) continue
    curatedQa.push({
      rel: `${name}/${f}`,
      text: fs.readFileSync(path.join(dir, f), 'utf8'),
    })
  }
}

// 清空模块目录，保留 _full / glossary / modules
for (const name of fs.readdirSync(outRoot)) {
  const p = path.join(outRoot, name)
  if (!fs.statSync(p).isDirectory()) continue
  if (name === '_full') continue
  fs.rmSync(p, { recursive: true, force: true })
}

write(
  'modules.yaml',
  MODULES.map(([id, name, order]) => `- id: ${id}\n  name: ${name}\n  order: ${order}`).join('\n') + '\n',
)

// —— 安装完整知识点 ——
const kpFiles = fs.readdirSync(fullRoot).filter((f) => f.endsWith('.md'))
let kpCount = 0
for (const file of kpFiles) {
  const raw = fs.readFileSync(path.join(fullRoot, file), 'utf8')
  const mod = (raw.match(/^module:\s*(.+)$/m) || [])[1]?.trim()
  const id = (raw.match(/^id:\s*(.+)$/m) || [])[1]?.trim()
  if (!mod || !id || !FOLDER[mod]) {
    console.warn('skip kp:', file)
    continue
  }
  // 确保七段齐全（兜底提示，不阻断）
  for (const h of ['一句话', '组成与结构', '原理', '使用与实践', '例子', '画面', '常见坑']) {
    if (!raw.includes(h)) console.warn('missing section', h, 'in', id)
  }
  write(`${FOLDER[mod]}/${id}.md`, raw.endsWith('\n') ? raw : raw + '\n')
  kpCount++
}

function extractQAs(md) {
  const parts = md.split(/\n(?=###\s+Q\d+[a-z]?\.)/)
  const items = []
  for (const part of parts) {
    const m = part.match(/^###\s+(Q\d+[a-z]?)\.\s*(.+?)\s*\n([\s\S]*)$/)
    if (!m) continue
    const rawTitle = m[2].trim()
    const priority = (rawTitle.match(/·\s*(P[012])\s*$/) || [])[1] || 'P1'
    const title = rawTitle.replace(/\s*·\s*P[012]\s*$/, '').trim()
    const answer = m[3].replace(/^\*\*A[：:]\*\*\s*/m, '').trim()
    items.push({ qid: m[1], title, priority, answer })
  }
  return items
}

const refMap = [
  [/Handler|Looper|Message|同步屏障|IdleHandler|HandlerThread/i, 'kp-handler-system'],
  [/启动模式|生命周期|onNewIntent|配置变更|进程回收/i, 'kp-activity-lifecycle'],
  [/触摸|分发|滑动冲突|onIntercept/i, 'kp-touch-dispatch'],
  [/Service|前台服务|保活|WorkManager/i, 'kp-service-bg'],
  [/ANR/i, 'kp-anr'],
  [/UDP/i, 'kp-udp'],
  [/TCP|三次握手|四次挥手/i, 'kp-tcp'],
  [/HTTPS|证书|TLS|Pinning|公钥/i, 'kp-https-cert'],
  [/QUIC|HTTP\/3|HTTP\/2/i, 'kp-quic'],
  [/长连接|心跳|重连|Ack|粘包/i, 'kp-long-connection'],
  [/WebSocket|Socket/i, 'kp-websocket'],
  [/OkHttp|拦截器|连接池/i, 'kp-okhttp'],
  [/DNS|CDN|HTTPDNS/i, 'kp-dns-cdn'],
  [/加密|对称|非对称|摘要|MD5|AES|RSA/i, 'kp-crypto-basic'],
  [/弱网|网络优化|超时|重试|断点/i, 'kp-net-optimize'],
  [/StateFlow|SharedFlow|冷流|热流|Flow|replay|flowOn/i, 'kp-coroutine-flow'],
  [/Channel|Mutex|Semaphore|限流/i, 'kp-coroutine-channel-mutex'],
  [/cancel|取消|Supervisor|CancellationException/i, 'kp-coroutine-cancel'],
  [/launch|async|withContext|结构化并发|coroutineScope/i, 'kp-coroutine-builders'],
  [/Dispatcher|Dispatchers\.|线程池.*协程|Default.*IO/i, 'kp-coroutine-dispatchers'],
  [/suspendCancellableCoroutine|suspendCoroutine|CompletableDeferred|callbackFlow|回调转挂起|回调.*挂起/i, 'kp-callback-to-suspend'],
  [/复习顺序|掌握地图|专家原理|协程.*掌握/i, 'kp-coroutine-roadmap'],
  [/CoroutineContext|CoroutineExceptionHandler|\bCEH\b|CoroutineName/i, 'kp-coroutine-context'],
  [/状态机|CPS|ContinuationInterceptor|COROUTINE_SUSPENDED|yield|delay\(0\)/i, 'kp-coroutine-internals'],
  [/背压|flatMap|stateIn|shareIn|WhileSubscribed|repeatOnLifecycle|collectAsState/i, 'kp-flow-backpressure-android'],
  [/协程|挂起|阻塞|续体|Continuation/i, 'kp-coroutine-basics'],
  [/MVI|MVVM|MVP|MVC|单向数据流|Effect/i, 'kp-arch-patterns'],
  [/组件化|模块化|依赖治理/i, 'kp-componentization'],
  [/路由|ARouter|Navigation/i, 'kp-router'],
  [/SDK|API 稳定|适配层|对外 API/i, 'kp-sdk-api'],
  [/Compose|重组|remember|AndroidView|LaunchedEffect|副作用/i, 'kp-compose-recomposition'],
  [/Glide|Coil|图片|Bitmap|三级缓存/i, 'kp-image-loader'],
  [/Hilt|Koin|Dagger|依赖注入|\bDI\b/i, 'kp-di'],
  [/三方|Retrofit|主流.*框架|分层/i, 'kp-framework-stack'],
  [/切班|底座|SEI|RTC|直播/i, 'kp-project-live-base'],
  [/IM|融云|消息可靠/i, 'kp-project-im'],
  [/离线|上传|分片/i, 'kp-project-offline-upload'],
  [/ThreadPool|线程池|拒绝策略|核心线程/i, 'kp-thread-pool'],
  [/ConcurrentHashMap|并发集合|CopyOnWrite/i, 'kp-concurrent-collections'],
  [/wait|notify|sleep|join|interrupt|yield/i, 'kp-wait-notify'],
  [/死锁|deadlock/i, 'kp-deadlock'],
  [/CAS|Atomic|ABA/i, 'kp-cas-atomic'],
  [/volatile|happens-before|可见性|指令重排/i, 'kp-volatile-hb'],
  [/synchronized|ReentrantLock|锁/i, 'kp-synchronized-lock'],
  [/线程状态|NEW|RUNNABLE|BLOCKED|WAITING/i, 'kp-thread-basics'],
  [/双亲委派|ClassLoader|类加载/i, 'kp-classloader'],
  [/运行时数据区|对象头|堆|栈帧|方法区/i, 'kp-jvm-memory'],
  [/\bGC\b|垃圾回收|分代|Mark/i, 'kp-gc-basics'],
  [/\bJMM\b|内存模型/i, 'kp-jmm'],
  [/Kotlin.*字节码|inline.*reified|协程状态机/i, 'kp-kotlin-jvm'],
  [/空安全|平台类型|\!\!|\?/i, 'kp-null-safety'],
  [/集合|HashMap|List|Set|Map|MutableList/i, 'kp-collections'],
  [/泛型|擦除|reified|out in/i, 'kp-generics'],
  [/data class|sealed|object|enum/i, 'kp-data-sealed'],
  [/equals|hashCode|===/i, 'kp-equals-hashcode'],
  [/扩展函数|高阶|Lambda|SAM/i, 'kp-extensions-hof'],
  [/混编|@JvmStatic|@JvmOverloads|@Throws|suspend.*Java/i, 'kp-java-kotlin-interop'],
  [/注解|异常|try|Checked/i, 'kp-annotations-exceptions'],
  [/lateinit|lazy|val |var |inline/i, 'kp-val-var-lazy'],
  [/String|不可变|常量池/i, 'kp-string-immutability'],
  [/面向对象|重载|重写|继承|多态|final|static/i, 'kp-oop-basics'],
  [/Agent|MCP|Skills|Rules|Plugin|AI Coding/i, 'kp-agent-what'],
]

function mapRef(title, fallback) {
  for (const [re, id] of refMap) if (re.test(title)) return id
  return fallback
}

const qaSources = [
  ['协程与并发.md', 'coroutine', '协程', 'kp-coroutine-basics'],
  ['基础知识/02-Android基础.md', 'android', 'Android', 'kp-handler-system'],
  ['基础知识/03-网络.md', 'network', '网络', 'kp-tcp'],
  ['基础知识/04-架构.md', 'architecture', '架构', 'kp-arch-patterns'],
  ['基础知识/05-常用组件框架.md', 'framework', '三方框架', 'kp-image-loader'],
  ['基础知识/06-Compose.md', 'compose', 'Compose', 'kp-compose-recomposition'],
  ['基础知识/01-语言与JVM.md', 'language', '语言', 'kp-oop-basics'],
  ['第1天-基础与主线项目.md', 'coroutine', '协程', 'kp-coroutine-basics'],
  ['Java线程与并发.md', 'concurrent', '并发', 'kp-thread-basics'],
  ['JVM与并发原理.md', 'jvm', 'JVM', 'kp-jmm'],
  ['语言-Kotlin与Java.md', 'language', '语言', 'kp-oop-basics'],
  ['语言-混编详解.md', 'language', '语言', 'kp-java-kotlin-interop'],
  ['Agent与AICoding.md', 'agent', 'Agent', 'kp-agent-what'],
]

const seenQ = new Map()
let qaCount = 0

for (const [file, module, folder, fallback] of qaSources) {
  let md
  try {
    md = readReview(file)
  } catch {
    continue
  }
  for (const q of extractQAs(md)) {
    let mod = module
    let fold = folder
    if (file.includes('第1天')) {
      if (/Handler|启动|生命周期|ANR|事件|Service/.test(q.title)) {
        mod = 'android'
        fold = 'Android'
      } else if (/synchronized|线程池|HashMap|死锁|volatile|sleep|wait|ConcurrentHashMap/.test(q.title)) {
        mod = 'concurrent'
        fold = '并发'
      } else if (/空安全|sealed|扩展|suspend|Java|data class|enum/.test(q.title)) {
        mod = 'language'
        fold = '语言'
      }
    }
    const key = q.title.replace(/\s/g, '')
    const prev = seenQ.get(key)
    if (prev && prev >= q.answer.length) continue
    const id = `q-${hash(key)}`
    write(
      `${fold}/${id}.md`,
      `---
id: ${id}
type: qa
module: ${mod}
knowledge_ref: ${mapRef(q.title, fallback)}
title: ${q.title.replace(/"/g, "'").slice(0, 40)}
priority: ${file.includes('第1天') ? 'P0' : q.priority}
version: 1
---

## 问题
${q.title}

## 答案
${q.answer}
`,
    )
    if (!prev) qaCount++
    seenQ.set(key, q.answer.length)
  }
}

// 项目表格式追问
{
  const md = readReview('项目重点.md')
  for (const row of md.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm)) {
    const q = row[1].trim()
    const a = row[2].trim()
    if (q.length < 4 || a.length < 4) continue
    if (/问题|重点条目|—|---/.test(q)) continue
    write(
      `项目/q-${hash('proj' + q)}.md`,
      `---
id: q-${hash('proj' + q)}
type: qa
module: project
knowledge_ref: ${mapRef(q, 'kp-project-live-base')}
title: ${q.replace(/"/g, "'").slice(0, 40)}
priority: P0
version: 1
---

## 问题
${q}

## 答案
${a}
`,
    )
    qaCount++
  }
}

// 算法
{
  const md = readReview('基础算法.md')
  for (const row of md.matchAll(/^\|\s*(必刷|次刷)\s*\|\s*\*\*?(\d+)\*\*?\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|$/gm)) {
    const [, level, no, title, tip] = row
    write(
      `算法/lc-${no}.md`,
      `---
id: algo-${no}
type: algo
module: algo
title: ${title.trim().replace(/"/g, "'")}
leetcode: ${no}
priority: ${level === '必刷' ? 'P0' : 'P1'}
version: 1
tags: ["算法"]
---

## 题目
力扣 ${no}：${title.trim()}

考点：${tip.trim() || '见题解'}

## 答案
思路：${tip.trim() || '先识别题型再套模板。'}

步骤：识别题型 → 写模板 → 补边界 → 口述复杂度。
`,
    )
  }
}

for (const item of curatedQa) {
  write(item.rel, item.text.endsWith('\n') ? item.text : item.text + '\n')
}

console.log(`applied full knowledge: kp=${kpCount} qa≈${qaCount} curatedQa=${curatedQa.length}`)
console.log('run: npm run content')
