import { Server } from '@hocuspocus/server'
import express from 'express'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.PORT || '3000', 10)

// sessions: token → { ws, requestedDocs, sseClients, fileTree }
const sessions = new Map()

function getSession(token) {
  return token ? sessions.get(token) : undefined
}

const hocuspocus = Server.configure({
  async onLoadDocument({ document, documentName }) {
    // documentName = "<token>/<filepath>"
    const slash = documentName.indexOf('/')
    if (slash === -1) return document
    const token = documentName.slice(0, slash)
    const docFile = documentName.slice(slash + 1)
    const session = getSession(token)
    if (!session) return document
    if (!session.requestedDocs.has(docFile)) {
      session.requestedDocs.add(docFile)
      if (session.ws?.readyState === 1) {
        session.ws.send(JSON.stringify({ type: 'open', name: docFile }))
      }
    }
    return document
  },
})

const app = express()
app.use(express.static(join(__dirname, 'public')))

app.get('/api/files', (req, res) => {
  const session = getSession(req.query.token)
  if (!session) return res.status(403).json({ error: 'invalid token' })
  res.json(session.fileTree)
})

app.get('/api/watch', (req, res) => {
  const session = getSession(req.query.token)
  if (!session) return res.status(403).end()
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  // Dokku's nginx proxy otherwise buffers this response, preventing browsers
  // from receiving the initial file-tree event on a quiet connection.
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  res.write(`data: ${JSON.stringify(session.fileTree)}\n\n`)
  session.sseClients.add(res)
  req.on('close', () => session.sseClients.delete(res))
})

const httpServer = createServer(app)

const wss = new WebSocketServer({ noServer: true })
const watcherWss = new WebSocketServer({ noServer: true })

watcherWss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x')
  const token = url.searchParams.get('token')
  if (!token) { ws.close(4001, 'missing token'); return }

  const session = { ws, requestedDocs: new Set(), sseClients: new Set(), fileTree: [] }
  sessions.set(token, session)
  console.log('[watcher] connected', token.slice(0, 8))

  // Replay any docs that were requested before watcher arrived
  for (const name of session.requestedDocs) {
    ws.send(JSON.stringify({ type: 'open', name }))
  }

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw)
      if (msg.type === 'filetree') {
        session.fileTree = msg.tree
        const payload = `data: ${JSON.stringify(msg.tree)}\n\n`
        for (const res of session.sseClients) res.write(payload)
      }
    } catch {}
  })

  ws.on('close', () => {
    sessions.delete(token)
    console.log('[watcher] disconnected', token.slice(0, 8))
  })

  ws.on('error', () => {})
})

httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://x')
  if (url.pathname === '/__watcher__') {
    watcherWss.handleUpgrade(request, socket, head, ws => {
      watcherWss.emit('connection', ws, request)
    })
  } else {
    // Validate token: pathname = "/<token>/<docName...>"
    const parts = url.pathname.slice(1).split('/')
    const token = parts[0]
    if (!token || !sessions.has(token)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, ws => {
      hocuspocus.handleConnection(ws, request)
    })
  }
})

httpServer.listen(PORT, () => console.log(`relay :${PORT}`))
