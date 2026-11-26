import {
  loadProgress,
  reconcileVersions,
  markKnowledgeRead,
  markQa,
  markAlgo,
  markSection,
  getSectionMastery,
  stats,
  moduleStats,
  getItemProgress,
} from './progress.js'
import { renderMarkdown, renderKnowledgeSections, buildGlossaryMap } from './markdown.js'
import {
  upsertNote,
  listNotes,
  openNoteCount,
  buildAgentPrompt,
  markNoteDone,
  removeNote,
} from './feedback.js'
import { syncAgentInbox, getLastSyncMeta } from './agentSync.js'
import {
  loadSyncConfig,
  saveSyncConfig,
  clearSyncToken,
  hasGithubAuth,
  rawUrl,
} from './syncConfig.js'
import { testGithubAuth, markSyncProcessed } from './githubInbox.js'
import { THEMES, initTheme, applyTheme, loadThemeId } from './theme.js'

const app = document.getElementById('app')
const wordPop = document.getElementById('word-pop')

let pack = null
let progress = loadProgress()
let glossaryMap = new Map()
let route = { name: 'home', args: [] }
initTheme()

let quizQueue = []
let quizIndex = 0
let showAnswer = false
let quizKey = ''

function parsePath(path) {
  const clean = String(path || 'home').replace(/^#\/?/, '').replace(/^\/+/, '')
  const [name, ...args] = clean.split('/').filter(Boolean)
  return { name: name || 'home', args }
}

function pathKey(r = route) {
  return [r.name, ...r.args].join('/')
}

/** 不依赖 hashchange：改地址 + 立刻渲染 */
function go(path) {
  const next = parsePath(path)
  route = next
  const hash = `#/${pathKey(next)}`
  if (location.hash !== hash) {
    location.hash = hash
  }
  render()
}

window.addEventListener('hashchange', () => {
  route = parsePath(location.hash)
  render()
})

async function boot() {
  app.innerHTML = `<div class="card muted">加载题库…</div>`
  try {
    const res = await fetch(`./content-pack.json?t=${Date.now()}`)
    if (!res.ok) throw new Error(`题库加载失败 HTTP ${res.status}，请在本目录执行 npm run content && npm run dev`)
    pack = await res.json()
    if (!pack.modules?.length) throw new Error('题库为空')
    glossaryMap = buildGlossaryMap(pack.glossary)
    progress = reconcileVersions(progress, pack)
    route = parsePath(location.hash || 'home')
    bindGlobalClicks()
    render()
  } catch (err) {
    app.innerHTML = `<div class="card"><strong>加载失败</strong>
      <p>${err.message}</p>
      <p class="muted">请在 interview-review 目录执行：</p>
      <pre>npm install\nnpm run content\nnpm run dev</pre>
      <p class="muted">然后用浏览器打开终端里的 Local 地址（不要直接双击 html 文件）</p>
    </div>`
  }
}

function moduleName(id) {
  return pack.modules.find((m) => m.id === id)?.name || id
}

function priorityTag(p) {
  return `<span class="tag ${p === 'P0' ? 'p0' : ''}">${p || 'P1'}</span>`
}

function statusLabel(item, type) {
  const p = getItemProgress(progress, item.id)
  if (!p) return '<span class="tag">未练</span>'
  if (p.status === 'stale') return '<span class="tag stale">需再练</span>'
  if (type === 'knowledge') return p.read ? '<span class="tag">已读</span>' : '<span class="tag">未读</span>'
  if (type === 'algo') return p.done ? '<span class="tag">完成</span>' : '<span class="tag">未完成</span>'
  if (p.status === 'known') return '<span class="tag">会了</span>'
  if (p.status === 'half') return '<span class="tag stale">半会</span>'
  if (p.status === 'unknown') return '<span class="tag wrong">不会</span>'
  return '<span class="tag">未练</span>'
}

function shell(title, body, { back = 'home', showTabs = true } = {}) {
  return `
    <div class="topbar">
      <div class="row">
        ${back !== null ? `<button type="button" class="nav-back" data-nav="${back}">← 返回</button>` : ''}
        <h1>${title}</h1>
      </div>
    </div>
    ${body}
    ${showTabs ? tabs() : ''}
  `
}

function tabs() {
  const s = stats(pack, progress)
  const wrongLabel = s.wrong ? `错题·${s.wrong}` : '错题'
  const staleLabel = s.stale ? `待复习·${s.stale}` : '待复习'
  return `<nav class="tabs" aria-label="主导航">
    <button type="button" data-nav="home" class="${route.name === 'home' ? 'on' : ''}">首页</button>
    <button type="button" data-nav="quiz/global" class="${pathKey().startsWith('quiz') ? 'on' : ''}">练习</button>
    <button type="button" data-nav="wrong">${wrongLabel}</button>
    <button type="button" data-nav="stale">${staleLabel}</button>
  </nav>`
}

function renderHome() {
  const s = stats(pack, progress)
  const mods = [...pack.modules].sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
  app.innerHTML = shell(
    '面试复习',
    `
    <div class="card stack">
      <div class="row space">
        <strong>整体 ${s.percent}%</strong>
        <span class="muted">${s.doneUnits}/${s.totalUnits}</span>
      </div>
      <div class="progress"><span style="width:${s.percent}%"></span></div>
      <div class="row muted">
        <span>知识 ${s.kpRead}/${s.kpTotal}</span>
        <span>问答 ${s.qaKnown}/${s.qaTotal}</span>
        <span>算法 ${s.algoDone}/${s.algoTotal}</span>
      </div>
      <div class="row">
        <button type="button" class="primary" data-nav="quiz/global">整体随机练习</button>
        <button type="button" data-nav="wrong">错题本</button>
        <button type="button" data-nav="stale">待复习</button>
        <button type="button" data-nav="feedback">${openNoteCount() ? `学习反馈 (${openNoteCount()})` : '学习反馈'}</button>
        <button type="button" data-action="sync-agent-inbox">同步给 Agent</button>
        <button type="button" data-nav="sync-settings">同步设置</button>
      </div>
      <p class="muted">「明白 / 不懂」给 Agent 改内容。点「同步给 Agent」写入本地并（已配 Token 时）上传 GitHub <code>agent-inbox/</code>。</p>
      <p id="sync-status" class="muted">${escapeText(formatLastSync())}</p>
    </div>
    <div class="card stack">
      <div class="row space">
        <h2 style="margin:0">主题色</h2>
        <span class="muted">点色块立即切换 · 仅本机</span>
      </div>
      ${themeSwatches()}
    </div>
    <div class="card">
      <h2>模块</h2>
      ${mods
        .map((m) => {
          const ms = moduleStats(pack, progress, m.id)
          return `<button type="button" class="list-item" data-nav="module/${m.id}">
            <div class="row space">
              <strong>${m.name}</strong>
              <span class="muted">${ms.percent}% · ${ms.done}/${ms.total}</span>
            </div>
            <div class="progress" style="margin-top:0.45rem"><span style="width:${ms.percent}%"></span></div>
          </button>`
        })
        .join('')}
    </div>`,
    { back: null },
  )
}

function sortByOrder(items) {
  return [...items].sort((a, b) => {
    const ao = a.order == null || Number.isNaN(Number(a.order)) ? 1e9 : Number(a.order)
    const bo = b.order == null || Number.isNaN(Number(b.order)) ? 1e9 : Number(b.order)
    if (ao !== bo) return ao - bo
    return String(a.title || a.id || '').localeCompare(String(b.title || b.id || ''), 'zh')
  })
}

function requiresHint(item) {
  const reqs = Array.isArray(item.requires) ? item.requires.filter(Boolean) : []
  if (!reqs.length) return ''
  const titles = reqs.map((id) => {
    const hit = pack.knowledge.find((k) => k.id === id) || pack.algo.find((a) => a.id === id)
    return hit?.title || id
  })
  return `<div class="muted kp-requires">先修：${escapeText(titles.join(' · '))}</div>`
}

function renderModule(moduleId) {
  const name = moduleName(moduleId)
  const kps = sortByOrder(pack.knowledge.filter((x) => x.module === moduleId))
  const qas = pack.qa.filter((x) => x.module === moduleId)
  const algos = sortByOrder(pack.algo.filter((x) => x.module === moduleId))
  app.innerHTML = shell(
    name,
    `
    <div class="card row">
      ${qas.length ? `<button type="button" class="primary" data-nav="quiz/module/${moduleId}">直接练习</button>
      <button type="button" data-nav="quiz/random/${moduleId}">模块内随机</button>` : ''}
    </div>
    ${
      kps.length
        ? `<div class="card"><h2>知识点（按复习顺序 · ${kps.length}）</h2>${kps
            .map(
              (k) => `<button type="button" class="list-item" data-nav="kp/${k.id}">
            <div class="row space"><span>${escapeText(k.title)}</span><span>${priorityTag(k.priority)} ${statusLabel(k, 'knowledge')}</span></div>
            ${requiresHint(k)}
          </button>`,
            )
            .join('')}</div>`
        : ''
    }
    ${
      qas.length
        ? `<div class="card"><h2>问答（${qas.length}）</h2>${qas
            .map(
              (q) => `<button type="button" class="list-item" data-nav="quiz/one/${q.id}">
            <div class="row space"><span>${escapeText(q.question)}</span>
            <span>${priorityTag(q.priority)} ${statusLabel(q, 'qa')}</span></div>
          </button>`,
            )
            .join('')}</div>`
        : ''
    }
    ${
      algos.length
        ? `<div class="card"><h2>算法（${algos.length}）</h2>${algos
            .map(
              (a) => `<button type="button" class="list-item" data-nav="algo/${a.id}">
            <div class="row space"><span>${a.leetcode ? a.leetcode + ' · ' : ''}${a.title}</span>
            <span>${priorityTag(a.priority)} ${statusLabel(a, 'algo')}</span></div>
          </button>`,
            )
            .join('')}</div>`
        : ''
    }
    ${!kps.length && !qas.length && !algos.length ? `<div class="card muted">该模块暂无内容</div>` : ''}
  `,
  )
}

function escapeText(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function renderKnowledge(id) {
  const k = pack.knowledge.find((x) => x.id === id)
  if (!k) return renderMissing()
  const related = pack.qa.filter((q) => q.knowledge_ref === id)
  const pending = listNotes().filter((n) => n.targetId === id && n.status !== 'done')
  const sectionMastery = getItemProgress(progress, id)?.sections || {}
  app.innerHTML = shell(
    k.title,
    `
    <div class="card kp-meta">
      <div class="row">${priorityTag(k.priority)} <span class="tag">v${k.version}</span> ${statusLabel(k, 'knowledge')}</div>
      <p class="muted kp-guide">蓝点英文可点看释义与音标。每节可点「这节明白 / 不懂」；首页可导出标注给 Agent。</p>
    </div>
    <div class="kp-body">${renderKnowledgeSections(k.body, glossaryMap, sectionMastery)}</div>
    <div class="card">
      <div class="row">
        <button type="button" class="primary" data-action="read-kp" data-id="${k.id}" data-version="${k.version}">标为已读</button>
        <button type="button" data-action="feedback-open" data-id="${k.id}">整篇不懂 / 要补充</button>
        ${
          related.length
            ? `<button type="button" data-nav="quiz/related/${k.id}">练习相关问答 (${related.length})</button>`
            : `<button type="button" data-nav="quiz/module/${k.module}">练习本模块</button>`
        }
      </div>
      ${
        pending.length
          ? `<p class="muted" style="margin-top:0.75rem">本篇已有 ${pending.length} 条待补充反馈 · <button type="button" class="linkish" data-nav="feedback">去反馈箱</button></p>`
          : ''
      }
    </div>
    <div id="feedback-sheet" class="feedback-sheet hidden"></div>`,
    { back: `module/${k.module}` },
  )
}

function isWeChatBrowser() {
  return /MicroMessenger/i.test(navigator.userAgent || '')
}

function speechErrorHint(code) {
  const map = {
    'not-allowed': '麦克风被拒绝：地址栏左侧站点设置 → 允许麦克风后重试',
    'service-not-allowed': '浏览器禁止语音服务（需 localhost 或 HTTPS）',
    network:
      '识别云服务连不上（Chrome 依赖 Google，国内很常见）。请改用 Safari，或 Mac 键盘上 Fn/地球键 语音输入后粘贴到这里',
    'no-speech': '没检测到说话。请靠近麦克风，说完后再点「停止」',
    aborted: '已取消',
    'audio-capture': '找不到麦克风',
    'bad-grammar': '识别配置异常',
    'language-not-supported': '当前环境不支持中文语音识别，请换 Safari 试试',
  }
  return map[code] || `语音识别失败：${code || 'unknown'}`
}

function openFeedbackSheet({ targetId, title, module, section = '', kind = 'unclear' }) {
  const sheet = document.getElementById('feedback-sheet')
  if (!sheet) return
  const kindLabel = { unclear: '不懂，要解释更清楚', fix: '内容可能有误', expand: '要加深 / 补例子' }
  const SpeechCtor = window.SpeechRecognition || window.webkitSpeechRecognition
  const inWeChat = isWeChatBrowser()
  const canSpeech = Boolean(SpeechCtor) && !inWeChat
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent || '')
  sheet.classList.remove('hidden')
  sheet.innerHTML = `
    <h3>记下疑问（稍后可批量交给 Agent）</h3>
    <p class="muted">${escapeText(title)}${section ? ` · ${escapeText(section)}` : ''}</p>
    <div class="row" style="margin:0.5rem 0">
      ${Object.entries(kindLabel)
        .map(
          ([k, lab]) =>
            `<button type="button" class="chip ${k === kind ? 'on' : ''}" data-kind="${k}">${lab}</button>`,
        )
        .join('')}
    </div>
    <textarea id="feedback-text" rows="4" placeholder="例如：粘包拆包还是不懂，想看一个收包循环的小例子……"></textarea>
    <div class="row" style="margin-top:0.75rem">
      <button type="button" class="primary" id="feedback-save">保存到反馈箱</button>
      ${
        canSpeech
          ? `<button type="button" id="feedback-mic" class="mic-btn" title="语音转文字">语音输入</button>`
          : ''
      }
      <button type="button" id="feedback-cancel">取消</button>
    </div>
    <p id="feedback-mic-status" class="mic-status">${
      inWeChat
        ? '微信内置浏览器通常无法语音识别。请用系统键盘语音，或用 Safari/Chrome 打开。'
        : canSpeech
          ? isSafari
            ? '点「语音输入」开始 → 说话 → 再点「停止」。Safari 一般用系统识别，国内更稳。'
            : '点「语音输入」开始 → 说话 → 再点「停止」。Chrome 需连 Google 识别云；若不出字请看下方红字，或改用 Safari / 系统语音输入。'
          : '当前浏览器不支持 Web Speech，请直接打字或用系统键盘语音。'
    }</p>`
  let selectedKind = kind
  let recognition = null
  let listening = false
  let baseText = ''
  let gotResult = false

  sheet.querySelectorAll('[data-kind]').forEach((btn) => {
    btn.onclick = (ev) => {
      ev.stopPropagation()
      selectedKind = btn.getAttribute('data-kind')
      sheet.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b === btn))
    }
  })

  const setMicUi = (on, statusText, level = '') => {
    const mic = sheet.querySelector('#feedback-mic')
    const status = sheet.querySelector('#feedback-mic-status')
    if (mic) {
      mic.classList.toggle('recording', on)
      mic.textContent = on ? '停止' : '语音输入'
    }
    if (status && statusText != null) {
      status.textContent = statusText
      status.classList.toggle('is-error', level === 'error')
      status.classList.toggle('is-ok', level === 'ok')
    }
  }

  const stopMic = (manual = false) => {
    listening = false
    try {
      if (manual) recognition?.stop()
      else recognition?.abort?.()
    } catch {
      try {
        recognition?.stop()
      } catch {
        /* ignore */
      }
    }
    recognition = null
    setMicUi(false)
  }

  const micBtn = sheet.querySelector('#feedback-mic')
  if (micBtn) {
    micBtn.onclick = (ev) => {
      ev.stopPropagation()
      const ta = sheet.querySelector('#feedback-text')
      if (listening) {
        // 用户主动停止：让引擎吐出最终结果
        listening = false
        try {
          recognition?.stop()
        } catch {
          /* ignore */
        }
        setMicUi(
          false,
          gotResult || ta.value.trim()
            ? '已停止，文字应在上方输入框'
            : '已停止，仍无文字：多半是识别云连不上。请换 Safari，或用键盘 Fn/地球键语音输入',
          gotResult || ta.value.trim() ? 'ok' : 'error',
        )
        return
      }

      recognition = new SpeechCtor()
      recognition.lang = 'zh-CN'
      // continuous：说较长一句时不容易被提前掐断；用户点「停止」结束
      recognition.continuous = true
      recognition.interimResults = true
      recognition.maxAlternatives = 1
      baseText = ta.value
      gotResult = false
      listening = true
      setMicUi(true, '正在听…请说话，说完点「停止」', '')

      recognition.onstart = () => {
        setMicUi(true, '麦克风已开，请说话…', '')
      }
      recognition.onaudiostart = () => {
        setMicUi(true, '已采到声音，识别中…', '')
      }
      recognition.onspeechstart = () => {
        setMicUi(true, '检测到说话…', '')
      }
      recognition.onresult = (event) => {
        let interim = ''
        let finalChunk = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i][0].transcript
          if (event.results[i].isFinal) finalChunk += piece
          else interim += piece
        }
        if (finalChunk) {
          gotResult = true
          const join = baseText && !/\s$/.test(baseText) ? '' : ''
          baseText = `${baseText}${join}${finalChunk}`
          ta.value = baseText
          setMicUi(true, `已识别：${finalChunk}`, 'ok')
        } else if (interim) {
          gotResult = true
          ta.value = `${baseText}${interim}`
          setMicUi(true, `识别中：${interim}`, '')
        }
      }
      recognition.onerror = (event) => {
        const code = event.error || 'unknown'
        if (code === 'aborted') return
        listening = false
        setMicUi(false, speechErrorHint(code), 'error')
        recognition = null
      }
      recognition.onend = () => {
        if (listening) {
          // continuous 被浏览器打断时自动续听
          try {
            recognition.start()
            setMicUi(true, '继续听…说完请点「停止」', '')
            return
          } catch {
            listening = false
          }
        }
        listening = false
        const ok = gotResult || Boolean(ta.value.trim() && ta.value !== baseText) || Boolean(ta.value.trim())
        setMicUi(
          false,
          ok
            ? '识别结束，请查看上方输入框'
            : '没有识别到文字。常见原因：Chrome 连不上 Google 识别云。请换 Safari，或用系统语音输入后粘贴',
          ok ? 'ok' : 'error',
        )
        recognition = null
      }
      try {
        recognition.start()
      } catch (err) {
        listening = false
        setMicUi(false, `无法启动：${err?.message || err}`, 'error')
        recognition = null
      }
    }
  }

  sheet.querySelector('#feedback-cancel').onclick = (ev) => {
    ev.stopPropagation()
    stopMic(true)
    sheet.classList.add('hidden')
    sheet.innerHTML = ''
  }
  sheet.querySelector('#feedback-save').onclick = (ev) => {
    ev.stopPropagation()
    stopMic(true)
    const text = sheet.querySelector('#feedback-text').value
    upsertNote({
      targetId,
      targetType: 'knowledge',
      title,
      module,
      kind: selectedKind,
      section,
      text,
    })
    sheet.classList.add('hidden')
    sheet.innerHTML = ''
    render()
    void pushInbox(null, {
      preferGithub: loadSyncConfig().autoUploadOnMark,
      allowDownloadFallback: false,
    })
  }
}

function formatLastSync() {
  const last = getLastSyncMeta()
  if (!last?.syncId) return hasGithubAuth() ? '已配置 GitHub，点同步即可上传' : '未配置 Token：手机请先到「同步设置」'
  return `上次同步: ${last.syncId} · ${(last.modes || []).join('+') || '-'}`
}

async function pushInbox(btn, options = {}) {
  if (!pack) return
  const label = btn?.textContent
  if (btn) btn.textContent = '同步中…'
  const status = document.getElementById('sync-status')
  try {
    const result = await syncAgentInbox(pack, progress, options)
    const msg = result.hint || `同步完成 · ${result.syncId}`
    if (status) status.textContent = msg
    if (btn) {
      const doneLabel = result.modes?.includes('github')
        ? '已上传'
        : result.modes?.includes('workspace')
          ? '已写入'
          : '已下载'
      btn.textContent = doneLabel
      setTimeout(() => {
        if (label) btn.textContent = label
      }, 1800)
    }
  } catch (err) {
    if (status) status.textContent = `同步失败: ${err?.message || err}`
    if (btn && label) btn.textContent = label
  }
}

function themeSwatches() {
  const active = loadThemeId()
  return `<div class="theme-grid">${THEMES.map((t) => {
    const v = t.vars
    return `<button type="button" class="theme-swatch ${t.id === active ? 'on' : ''}" data-action="set-theme" data-theme="${t.id}">
      <strong>${escapeText(t.name)}</strong>
      <span class="swatch-bar" aria-hidden="true">
        <i style="background:${v['--bg']}"></i>
        <i style="background:${v['--panel']}"></i>
        <i style="background:${v['--accent']}"></i>
        <i style="background:${v['--text']}"></i>
      </span>
    </button>`
  }).join('')}</div>`
}

function renderAppearance() {
  app.innerHTML = shell(
    '外观',
    `
    <div class="card stack">
      <p class="muted">颜色只存在本机浏览器，不影响题库内容。横屏时内容区会自动加宽。</p>
      <h2>主题色</h2>
      ${themeSwatches()}
    </div>`,
  )
}

function renderSyncSettings() {
  const cfg = loadSyncConfig()
  const last = getLastSyncMeta()
  app.innerHTML = shell(
    '同步设置',
    `
    <div class="card stack">
      <p class="muted">Token 只存在本浏览器，不会进题库。建议用 GitHub Fine-grained Token，仅本仓库 Contents 读写。</p>
      <label class="field">
        <span>Owner</span>
        <input id="sync-owner" value="${escapeAttr(cfg.owner)}" autocomplete="off" />
      </label>
      <label class="field">
        <span>Repo</span>
        <input id="sync-repo" value="${escapeAttr(cfg.repo)}" autocomplete="off" />
      </label>
      <label class="field">
        <span>Branch</span>
        <input id="sync-branch" value="${escapeAttr(cfg.branch)}" autocomplete="off" />
      </label>
      <label class="field">
        <span>Token</span>
        <input id="sync-token" type="password" value="${escapeAttr(cfg.token)}" placeholder="ghp_… / github_pat_…" autocomplete="off" />
      </label>
      <label class="row" style="gap:0.4rem">
        <input id="sync-auto" type="checkbox" ${cfg.autoUploadOnMark ? 'checked' : ''} />
        <span class="muted">标注「明白/不懂」时自动上传 GitHub</span>
      </label>
      <div class="row">
        <button type="button" class="primary" id="sync-save">保存</button>
        <button type="button" id="sync-test">测试连接</button>
        <button type="button" id="sync-clear-token">清除 Token</button>
      </div>
      <p id="sync-settings-status" class="muted"></p>
      <p class="muted">远端 latest：<code class="wrap">${escapeText(rawUrl(cfg, cfg.paths.latestMd))}</code></p>
    </div>
    <div class="card stack">
      <h2>批次</h2>
      <p class="muted">${last?.syncId ? `最近同步 syncId: ${escapeText(last.syncId)}` : '还没有同步过'}</p>
      <div class="row">
        <button type="button" class="primary" data-action="sync-agent-inbox">立即同步</button>
        <button type="button" id="sync-mark-processed" ${last?.syncId ? '' : 'disabled'}>标记最近批次已处理</button>
        <button type="button" data-nav="home">回首页</button>
      </div>
      <p id="sync-processed-status" class="muted"></p>
    </div>`,
    { back: 'home' },
  )

  const statusEl = () => document.getElementById('sync-settings-status')

  document.getElementById('sync-save').onclick = (ev) => {
    ev.stopPropagation()
    saveSyncConfig({
      owner: document.getElementById('sync-owner').value.trim(),
      repo: document.getElementById('sync-repo').value.trim(),
      branch: document.getElementById('sync-branch').value.trim() || 'main',
      token: document.getElementById('sync-token').value.trim(),
      autoUploadOnMark: document.getElementById('sync-auto').checked,
    })
    if (statusEl()) statusEl().textContent = '已保存到本浏览器'
    render()
  }

  document.getElementById('sync-test').onclick = async (ev) => {
    ev.stopPropagation()
    saveSyncConfig({
      owner: document.getElementById('sync-owner').value.trim(),
      repo: document.getElementById('sync-repo').value.trim(),
      branch: document.getElementById('sync-branch').value.trim() || 'main',
      token: document.getElementById('sync-token').value.trim(),
      autoUploadOnMark: document.getElementById('sync-auto').checked,
    })
    if (statusEl()) statusEl().textContent = '测试中…'
    try {
      const info = await testGithubAuth()
      if (statusEl()) statusEl().textContent = `连接成功：${info.fullName}（默认分支 ${info.defaultBranch}）`
    } catch (err) {
      if (statusEl()) statusEl().textContent = `失败：${err?.message || err}`
    }
  }

  document.getElementById('sync-clear-token').onclick = (ev) => {
    ev.stopPropagation()
    clearSyncToken()
    render()
  }

  document.getElementById('sync-mark-processed').onclick = async (ev) => {
    ev.stopPropagation()
    const meta = getLastSyncMeta()
    const out = document.getElementById('sync-processed-status')
    if (!meta?.syncId) return
    if (out) out.textContent = '写入 processed.json…'
    try {
      await markSyncProcessed(meta.syncId, 'marked-from-app')
      if (out) out.textContent = `已标记 processed: ${meta.syncId}`
    } catch (err) {
      if (out) out.textContent = `失败：${err?.message || err}`
    }
  }
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

function renderFeedback() {
  const notes = listNotes().filter((n) => n.status !== 'done')
  const done = listNotes().filter((n) => n.status === 'done').slice(0, 20)
  const prompt = buildAgentPrompt(notes)
  app.innerHTML = shell(
    '学习反馈',
    `
    <div class="card stack">
      <p>「不懂」会写入本机，并同步到 <code>agent-inbox/latest.md</code> 给 Agent 改题。也可复制下面提示词粘贴到对话。</p>
      <div class="row">
        <button type="button" class="primary" data-action="sync-agent-inbox">同步给 Agent</button>
        <button type="button" id="copy-agent-prompt" ${notes.length ? '' : 'disabled'}>复制提示词</button>
        <button type="button" data-nav="home">回首页</button>
      </div>
      <pre class="export-box" id="agent-prompt-box">${escapeText(prompt)}</pre>
    </div>
    <div class="card">
      <h2>待处理（${notes.length}）</h2>
      ${
        notes.length
          ? notes
              .map((n) => {
                const kind = { unclear: '不懂', fix: '有误', expand: '加深' }[n.kind] || n.kind
                return `<div class="feedback-item">
                  <div class="row space">
                    <strong>${escapeText(n.title)}</strong>
                    <span class="tag">${kind}</span>
                  </div>
                  <p class="muted">${n.section ? `章节：${escapeText(n.section)} · ` : ''}${escapeText(n.text || '（未写具体疑问）')}</p>
                  <div class="row">
                    <button type="button" data-nav="kp/${n.targetId}">打开知识点</button>
                    <button type="button" data-action="feedback-done" data-id="${n.id}">已补充</button>
                    <button type="button" data-action="feedback-del" data-id="${n.id}">删除</button>
                  </div>
                </div>`
              })
              .join('')
          : '<p class="muted">暂无。去任意知识点点「这节不懂」即可添加。</p>'
      }
    </div>
    ${
      done.length
        ? `<div class="card"><h2>已处理（近 ${done.length}）</h2>
        ${done.map((n) => `<p class="muted">✓ ${escapeText(n.title)} — ${escapeText(n.text || '')}</p>`).join('')}</div>`
        : ''
    }`,
    { back: 'home' },
  )
  const copyBtn = document.getElementById('copy-agent-prompt')
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(prompt)
        copyBtn.textContent = '已复制'
        setTimeout(() => {
          copyBtn.textContent = '复制给 Agent'
        }, 1500)
      } catch {
        const box = document.getElementById('agent-prompt-box')
        if (box) {
          const range = document.createRange()
          range.selectNodeContents(box)
          const sel = window.getSelection()
          sel.removeAllRanges()
          sel.addRange(range)
        }
        alert('请手动复制上方文本框内容')
      }
    }
  }
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function buildQuizQueue() {
  const { name, args } = route
  if (name !== 'quiz') return []
  const mode = args[0]
  if (mode === 'one') {
    const q = pack.qa.find((x) => x.id === args[1])
    return q ? [q] : []
  }
  if (mode === 'related') return pack.qa.filter((q) => q.knowledge_ref === args[1])
  if (mode === 'module') return pack.qa.filter((q) => q.module === args[1])
  if (mode === 'random') return shuffle(pack.qa.filter((q) => q.module === args[1]))
  if (mode === 'global') return shuffle([...pack.qa])
  if (mode === 'wrong') return pack.qa.filter((q) => getItemProgress(progress, q.id)?.inWrongBook)
  if (mode === 'stale') return pack.qa.filter((q) => getItemProgress(progress, q.id)?.status === 'stale')
  return []
}

function renderQuiz() {
  const key = pathKey()
  if (key !== quizKey) {
    quizKey = key
    quizQueue = buildQuizQueue()
    quizIndex = 0
    showAnswer = false
  }

  if (!quizQueue.length) {
    app.innerHTML = shell('练习', `<div class="card">当前没有可练习的问答。<div class="row" style="margin-top:0.75rem"><button type="button" class="primary" data-nav="home">回首页</button></div></div>`)
    return
  }

  if (quizIndex >= quizQueue.length) {
    app.innerHTML = shell(
      '本轮完成',
      `<div class="card stack">
        <p>已练完 ${quizQueue.length} 题。</p>
        <div class="row">
          <button type="button" class="primary" data-nav="home">回首页</button>
          <button type="button" data-nav="${pathKey()}">再来一轮</button>
        </div>
      </div>`,
    )
    quizKey = ''
    return
  }

  const q = quizQueue[quizIndex]
  const stale = getItemProgress(progress, q.id)?.status === 'stale'
  app.innerHTML = shell(
    `问答 ${quizIndex + 1}/${quizQueue.length}`,
    `
    <div class="card">
      <div class="row">
        <span class="tag">${moduleName(q.module)}</span>
        ${priorityTag(q.priority)}
        <span class="tag">v${q.version}</span>
        ${stale ? '<span class="tag stale">内容已更新</span>' : ''}
      </div>
      <div class="question-text">${escapeText(q.question)}</div>
      ${
        showAnswer
          ? `<div class="answer-box markdown">${renderMarkdown(q.answer, glossaryMap)}</div>
             <p class="muted">对照自己的口述，点下方按钮</p>
             <div class="row" style="margin-top:0.75rem">
               <button type="button" class="good" data-action="grade" data-result="known">会了</button>
               <button type="button" class="warn" data-action="grade" data-result="half">半会</button>
               <button type="button" class="bad" data-action="grade" data-result="unknown">不会</button>
             </div>`
          : `<button type="button" class="primary" data-action="reveal">看答案</button>`
      }
    </div>`,
    { back: `module/${q.module}` },
  )
}

function renderWrongOrStale(kind) {
  const list =
    kind === 'wrong'
      ? pack.qa.filter((q) => getItemProgress(progress, q.id)?.inWrongBook)
      : pack.qa.filter((q) => getItemProgress(progress, q.id)?.status === 'stale')
  const title = kind === 'wrong' ? '错题本' : '待复习'
  app.innerHTML = shell(
    title,
    `
    <div class="card row">
      <button type="button" class="primary" data-nav="quiz/${kind}" ${list.length ? '' : 'disabled'}>开始练习 (${list.length})</button>
    </div>
    <div class="card">
      ${
        list.length
          ? list
              .map(
                (q) => `<button type="button" class="list-item" data-nav="quiz/one/${q.id}">
              <div class="row space"><span>${escapeText(q.question)}</span>${statusLabel(q, 'qa')}</div>
            </button>`,
              )
              .join('')
          : `<p class="muted">暂无题目</p>`
      }
    </div>`,
  )
}

function renderAlgo(id) {
  const a = pack.algo.find((x) => x.id === id)
  if (!a) return renderMissing()
  app.innerHTML = shell(
    a.title,
    `
    <div class="card">
      <div class="row">
        ${a.leetcode ? `<span class="tag">LC ${a.leetcode}</span>` : ''}
        ${priorityTag(a.priority)}
        <span class="tag">v${a.version}</span>
        ${statusLabel(a, 'algo')}
      </div>
      <h3>题目</h3>
      <div class="markdown">${renderMarkdown(a.problem, glossaryMap)}</div>
      <details style="margin-top:0.75rem" open>
        <summary>看答案 / 思路</summary>
        <div class="answer-box markdown">${renderMarkdown(a.answer, glossaryMap)}</div>
      </details>
      <div class="row" style="margin-top:1rem">
        <button type="button" class="good" data-action="algo-done" data-id="${a.id}" data-version="${a.version}" data-done="1">完成</button>
        <button type="button" class="bad" data-action="algo-done" data-id="${a.id}" data-version="${a.version}" data-done="0">不会</button>
      </div>
    </div>`,
    { back: `module/${a.module}` },
  )
}

function renderMissing() {
  app.innerHTML = shell('未找到', `<div class="card">内容不存在。<button type="button" data-nav="home">回首页</button></div>`)
}

function render() {
  if (!pack) return
  if (route.name !== 'quiz') {
    quizQueue = []
    quizIndex = 0
    showAnswer = false
    quizKey = ''
  }

  try {
    if (route.name === 'home') renderHome()
    else if (route.name === 'module') renderModule(route.args[0])
    else if (route.name === 'kp') renderKnowledge(route.args[0])
    else if (route.name === 'quiz') renderQuiz()
    else if (route.name === 'wrong') renderWrongOrStale('wrong')
    else if (route.name === 'stale') renderWrongOrStale('stale')
    else if (route.name === 'algo') renderAlgo(route.args[0])
    else if (route.name === 'feedback') renderFeedback()
    else if (route.name === 'sync-settings') renderSyncSettings()
    else if (route.name === 'appearance') renderAppearance()
    else renderHome()
  } catch (err) {
    console.error(err)
    app.innerHTML = `<div class="card"><strong>渲染出错</strong><pre>${escapeText(err.stack || err.message)}</pre>
      <button type="button" data-nav="home">回首页</button></div>`
  }
}

function bindGlobalClicks() {
  // 捕获阶段，避免被其它监听抢走
  document.addEventListener(
    'click',
    (e) => {
      const nav = e.target.closest('[data-nav]')
      if (nav) {
        e.preventDefault()
        e.stopPropagation()
        const path = nav.getAttribute('data-nav')
        if (path.startsWith('quiz/')) quizKey = ''
        go(path)
        window.scrollTo(0, 0)
        return
      }

      const actionEl = e.target.closest('[data-action]')
      if (!actionEl) {
        const word = e.target.closest('.word')
        if (word) {
          e.preventDefault()
          showWord(word.dataset.word)
        } else if (!e.target.closest('.word-pop')) {
          hideWord()
        }
        return
      }

      e.preventDefault()
      const action = actionEl.getAttribute('data-action')
      if (action === 'reveal') {
        showAnswer = true
        renderQuiz()
        return
      }
      if (action === 'grade') {
        const q = quizQueue[quizIndex]
        markQa(progress, q.id, q.version, actionEl.getAttribute('data-result'))
        quizIndex += 1
        showAnswer = false
        renderQuiz()
        return
      }
      if (action === 'set-theme') {
        applyTheme(actionEl.dataset.theme || 'night-blue')
        render()
        return
      }
      if (action === 'read-kp') {
        markKnowledgeRead(progress, actionEl.dataset.id, Number(actionEl.dataset.version))
        render()
        return
      }
      if (action === 'algo-done') {
        markAlgo(progress, actionEl.dataset.id, Number(actionEl.dataset.version), actionEl.dataset.done === '1')
        render()
        return
      }
      if (action === 'section-known') {
        const section = actionEl.dataset.section || ''
        const kid = route.args[0]
        if (!kid || !section) return
        const cur = getSectionMastery(progress, kid, section)
        markSection(progress, kid, section, cur === 'known' ? null : 'known')
        render()
        void pushInbox(null, {
          preferGithub: loadSyncConfig().autoUploadOnMark,
          allowDownloadFallback: false,
        })
        return
      }
      if (action === 'feedback-section') {
        const section = actionEl.dataset.section || ''
        const k = pack.knowledge.find((x) => x.id === route.args[0])
        if (!k) return
        markSection(progress, k.id, section, 'unclear')
        void pushInbox(null, {
          preferGithub: loadSyncConfig().autoUploadOnMark,
          allowDownloadFallback: false,
        })
        openFeedbackSheet({
          targetId: k.id,
          title: k.title,
          module: k.module,
          section,
          kind: 'unclear',
        })
        return
      }
      if (action === 'sync-agent-inbox') {
        void pushInbox(actionEl, { preferGithub: true })
        return
      }
      if (action === 'feedback-open') {
        const k = pack.knowledge.find((x) => x.id === actionEl.dataset.id)
        if (!k) return
        openFeedbackSheet({
          targetId: k.id,
          title: k.title,
          module: k.module,
          kind: 'unclear',
        })
        return
      }
      if (action === 'feedback-done') {
        markNoteDone(actionEl.dataset.id)
        render()
        return
      }
      if (action === 'feedback-del') {
        removeNote(actionEl.dataset.id)
        render()
      }
    },
    true,
  )
}

function showWord(word) {
  const g = glossaryMap.get(word) || glossaryMap.get(String(word).toLowerCase())
  const phonetic = normalizePhonetic(g?.phonetic) || guessPhonetic(word)
  const speakText = resolveSpeakText(word, g)
  wordPop.classList.remove('hidden')
  wordPop.innerHTML = `
    <div class="word-title">${escapeText(word)}</div>
    <div class="phonetic" lang="en">${escapeText(phonetic)}</div>
    <div class="word-meaning">${escapeText(g?.meaning || '术语表暂无收录，可让 Agent 写入 glossary.yaml')}</div>
    <div class="row" style="margin-top:0.75rem">
      <button type="button" class="primary" id="speak-btn">读音</button>
      <button type="button" id="close-word">关闭</button>
    </div>`
  wordPop.querySelector('#close-word').onclick = (ev) => {
    ev.stopPropagation()
    hideWord()
  }
  wordPop.querySelector('#speak-btn').onclick = (ev) => {
    ev.stopPropagation()
    speak(speakText)
  }
}

function hideWord() {
  wordPop.classList.add('hidden')
  wordPop.innerHTML = ''
}

function normalizePhonetic(p) {
  const s = String(p || '').trim()
  if (!s || s === '—' || s === '-' || s === 'N/A') return ''
  return s
}

function guessPhonetic(word) {
  const w = String(word || '')
  if (/^[A-Z]{2,6}$/.test(w)) {
    return '/' + [...w].map((ch) => letterIpa(ch)).join(' ') + '/'
  }
  return '（暂无音标）'
}

function letterIpa(ch) {
  const map = {
    A: 'eɪ', B: 'biː', C: 'siː', D: 'diː', E: 'iː', F: 'ef', G: 'dʒiː', H: 'eɪtʃ',
    I: 'aɪ', J: 'dʒeɪ', K: 'keɪ', L: 'el', M: 'em', N: 'en', O: 'oʊ', P: 'piː',
    Q: 'kjuː', R: 'ɑːr', S: 'es', T: 'tiː', U: 'juː', V: 'viː', W: 'ˈdʌbljuː',
    X: 'eks', Y: 'waɪ', Z: 'ziː',
  }
  return map[ch] || ch
}

function resolveSpeakText(word, g) {
  if (g?.speak) return String(g.speak).trim()
  const w = String(word || '')
  if (/^[A-Z]{2,6}$/.test(w)) return [...w].join(' ')
  // CamelCase → 拆开，避免系统念成怪词
  return w
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/_/g, ' ')
}

let preferredEnVoice = null
function pickEnVoice() {
  if (preferredEnVoice) return preferredEnVoice
  const voices = window.speechSynthesis?.getVoices?.() || []
  preferredEnVoice =
    voices.find((v) => /en-US/i.test(v.lang) && /Samantha|Jenny|Aria|Google US/i.test(v.name)) ||
    voices.find((v) => /en-US/i.test(v.lang)) ||
    voices.find((v) => /^en(-|$)/i.test(v.lang)) ||
    null
  return preferredEnVoice
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    preferredEnVoice = null
    pickEnVoice()
  })
}

function speak(text) {
  if (!window.speechSynthesis) return
  const say = String(text || '').trim()
  if (!say) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(say)
  u.lang = 'en-US'
  u.rate = 0.9
  u.pitch = 1
  const voice = pickEnVoice()
  if (voice) u.voice = voice
  window.speechSynthesis.speak(u)
}

boot()
