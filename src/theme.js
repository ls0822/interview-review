const STORAGE_KEY = 'interview-review-theme'

export const THEMES = [
  {
    id: 'night-blue',
    name: '夜蓝',
    vars: {
      '--bg': '#0f1419',
      '--panel': '#1a2332',
      '--panel-2': '#243044',
      '--panel-deep': '#162031',
      '--surface': '#101826',
      '--ink': '#0b1018',
      '--text': '#e8eef7',
      '--muted': '#9aabbf',
      '--accent': '#3d9cfd',
      '--accent-ink': '#041018',
      '--good': '#3ecf8e',
      '--warn': '#f0b429',
      '--bad': '#f07178',
      '--line': '#2c3a4f',
      '--word': '#9fd0ff',
      '--progress-a': '#2f80ed',
      '--progress-b': '#56ccf2',
    },
  },
  {
    id: 'night-teal',
    name: '深青',
    vars: {
      '--bg': '#0c1514',
      '--panel': '#152422',
      '--panel-2': '#1f3532',
      '--panel-deep': '#11201e',
      '--surface': '#0f1c1a',
      '--ink': '#091412',
      '--text': '#e6f3ef',
      '--muted': '#95b3ab',
      '--accent': '#2ec4a7',
      '--accent-ink': '#041210',
      '--good': '#4ade80',
      '--warn': '#e8b84a',
      '--bad': '#f08080',
      '--line': '#2a4540',
      '--word': '#7ee0cb',
      '--progress-a': '#1fa88a',
      '--progress-b': '#5ad4b8',
    },
  },
  {
    id: 'slate',
    name: '石墨',
    vars: {
      '--bg': '#121212',
      '--panel': '#1e1e1e',
      '--panel-2': '#2a2a2a',
      '--panel-deep': '#181818',
      '--surface': '#1a1a1a',
      '--ink': '#0d0d0d',
      '--text': '#f0f0f0',
      '--muted': '#a0a0a0',
      '--accent': '#e8a87c',
      '--accent-ink': '#1a1008',
      '--good': '#7dce82',
      '--warn': '#e8c547',
      '--bad': '#e07a7a',
      '--line': '#333333',
      '--word': '#f0c9a8',
      '--progress-a': '#d4925a',
      '--progress-b': '#e8b88a',
    },
  },
  {
    id: 'paper',
    name: '纸白',
    vars: {
      '--bg': '#f3f1eb',
      '--panel': '#fffcf7',
      '--panel-2': '#ebe6dc',
      '--panel-deep': '#f7f4ee',
      '--surface': '#ffffff',
      '--ink': '#f0ebe3',
      '--text': '#1c2430',
      '--muted': '#5c6b7a',
      '--accent': '#2563eb',
      '--accent-ink': '#f8fbff',
      '--good': '#15803d',
      '--warn': '#b45309',
      '--bad': '#b91c1c',
      '--line': '#d5d0c6',
      '--word': '#1d4ed8',
      '--progress-a': '#2563eb',
      '--progress-b': '#60a5fa',
    },
  },
]

export function loadThemeId() {
  try {
    const id = localStorage.getItem(STORAGE_KEY)
    if (THEMES.some((t) => t.id === id)) return id
  } catch {
    /* ignore */
  }
  return THEMES[0].id
}

export function applyTheme(themeId) {
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0]
  const root = document.documentElement
  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(k, v)
  }
  root.dataset.theme = theme.id
  try {
    localStorage.setItem(STORAGE_KEY, theme.id)
  } catch {
    /* ignore */
  }
  return theme.id
}

export function initTheme() {
  return applyTheme(loadThemeId())
}
