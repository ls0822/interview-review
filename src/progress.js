const KEY = 'interview-review-progress-v1'

const defaultState = () => ({ items: {} })

export function loadProgress() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw)
    return { items: parsed.items || {} }
  } catch {
    return defaultState()
  }
}

export function saveProgress(state) {
  localStorage.setItem(KEY, JSON.stringify(state))
}

function ensure(state, id) {
  if (!state.items[id]) {
    state.items[id] = {
      status: 'unseen', // unseen | known | half | unknown | stale
      seenVersion: 0,
      read: false,
      readVersion: 0,
      done: false,
      doneVersion: 0,
      inWrongBook: false,
    }
  }
  return state.items[id]
}

/** After content pack loads, mark outdated mastery as stale */
export function reconcileVersions(state, pack) {
  const all = [...pack.knowledge, ...pack.qa, ...pack.algo]
  for (const item of all) {
    const p = state.items[item.id]
    if (!p) continue
    if (item.type === 'knowledge') {
      if (p.read && p.readVersion > 0 && p.readVersion < item.version) {
        p.read = false
        p.status = 'stale'
      }
    } else if (item.type === 'qa') {
      if (
        (p.status === 'known' || p.status === 'half') &&
        p.seenVersion > 0 &&
        p.seenVersion < item.version
      ) {
        p.status = 'stale'
      }
    } else if (item.type === 'algo') {
      if (p.done && p.doneVersion > 0 && p.doneVersion < item.version) {
        p.done = false
        p.status = 'stale'
      }
    }
  }
  saveProgress(state)
  return state
}

export function markKnowledgeRead(state, id, version) {
  const p = ensure(state, id)
  p.read = true
  p.readVersion = version
  if (p.status === 'stale') p.status = 'unseen'
  saveProgress(state)
}

export function markQa(state, id, version, result) {
  // result: known | half | unknown
  const p = ensure(state, id)
  p.status = result
  p.seenVersion = version
  p.inWrongBook = result === 'half' || result === 'unknown'
  saveProgress(state)
}

export function markAlgo(state, id, version, done) {
  const p = ensure(state, id)
  p.done = done
  p.doneVersion = version
  if (done) {
    p.status = 'known'
    p.inWrongBook = false
  } else {
    p.status = 'unknown'
    p.inWrongBook = true
  }
  saveProgress(state)
}

export function clearWrong(state, id) {
  const p = ensure(state, id)
  p.inWrongBook = false
  saveProgress(state)
}

export function getItemProgress(state, id) {
  return state.items[id] || null
}

export function stats(pack, state) {
  const kpTotal = pack.knowledge.length
  const qaTotal = pack.qa.length
  const algoTotal = pack.algo.length
  let kpRead = 0
  let qaKnown = 0
  let algoDone = 0
  let stale = 0
  let wrong = 0
  let p0Total = 0
  let p0Done = 0

  for (const k of pack.knowledge) {
    const p = state.items[k.id]
    if (p?.read) kpRead++
    if (p?.status === 'stale') stale++
    if (k.priority === 'P0') {
      p0Total++
      if (p?.read) p0Done++
    }
  }
  for (const q of pack.qa) {
    const p = state.items[q.id]
    if (p?.status === 'known') qaKnown++
    if (p?.status === 'stale') stale++
    if (p?.inWrongBook) wrong++
    if (q.priority === 'P0') {
      p0Total++
      if (p?.status === 'known') p0Done++
    }
  }
  for (const a of pack.algo) {
    const p = state.items[a.id]
    if (p?.done) algoDone++
    if (p?.status === 'stale') stale++
    if (p?.inWrongBook) wrong++
    if (a.priority === 'P0') {
      p0Total++
      if (p?.done) p0Done++
    }
  }

  const totalUnits = kpTotal + qaTotal + algoTotal
  const doneUnits = kpRead + qaKnown + algoDone
  return {
    kpTotal,
    kpRead,
    qaTotal,
    qaKnown,
    algoTotal,
    algoDone,
    stale,
    wrong,
    p0Total,
    p0Done,
    totalUnits,
    doneUnits,
    percent: totalUnits ? Math.round((doneUnits / totalUnits) * 100) : 0,
  }
}

export function moduleStats(pack, state, moduleId) {
  const kps = pack.knowledge.filter((x) => x.module === moduleId)
  const qas = pack.qa.filter((x) => x.module === moduleId)
  const algos = pack.algo.filter((x) => x.module === moduleId)
  const done =
    kps.filter((x) => state.items[x.id]?.read).length +
    qas.filter((x) => state.items[x.id]?.status === 'known').length +
    algos.filter((x) => state.items[x.id]?.done).length
  const total = kps.length + qas.length + algos.length
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 }
}
