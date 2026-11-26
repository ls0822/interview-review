import { defineConfig } from 'vite'

// GitHub Pages 若挂在 /repo-name/ 下，改成 base: '/repo-name/'
export default defineConfig({
  base: './',
  publicDir: 'public',
})
