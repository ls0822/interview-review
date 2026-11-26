import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const inboxDir = path.join(root, 'agent-inbox')

function agentInboxPlugin() {
  return {
    name: 'agent-inbox-writer',
    configureServer(server) {
      server.middlewares.use('/api/agent-inbox', (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'POST') return next()

        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
            fs.mkdirSync(inboxDir, { recursive: true })
            const mdPath = path.join(inboxDir, 'latest.md')
            const jsonPath = path.join(inboxDir, 'latest.json')
            const markdown =
              typeof body.markdown === 'string' ? body.markdown : '# 学习标注\n\n（无内容）\n'
            const envelope =
              body.envelope ||
              {
                syncId: null,
                status: 'pending',
                updatedAt: new Date().toISOString(),
                progress: body.progress || null,
                notes: body.notes || [],
              }
            fs.writeFileSync(mdPath, markdown, 'utf8')
            fs.writeFileSync(jsonPath, JSON.stringify(envelope, null, 2) + '\n', 'utf8')
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                ok: true,
                path: 'agent-inbox/latest.md',
                syncId: envelope.syncId || null,
              }),
            )
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  base: './',
  publicDir: 'public',
  plugins: [agentInboxPlugin()],
})
