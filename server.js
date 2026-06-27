import { Server } from '@hocuspocus/server'
import express from 'express'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.PORT || '3000', 10)

// SSE clients for live file-tree push to browsers
const sseClients = new Set()
// Control WebSocket from the local watcher process
let watcherWs = null
// Doc names already signaled to the watcher (to avoid duplicate signals)
const requestedDocs = new Set()
// Latest file tree received from watcher
let currentFileTree = []

const hocuspocus = Server.configure({
  async onLoadDocument({ document, documentName }) {
    // When any browser opens a file, signal the local watcher once
    if (!documentName.startsWith('__') && !requestedDocs.has(documentName)) {
      requestedDocs.add(documentName)
      if (watcherWs?.readyState === 1) {
        watcherWs.send(JSON.stringify({ type: 'open', name: documentName }))
      }
    }
    return document
  },
})

const app = express()
app.use(express.static(join(__dirname, 'public')))

app.get('/api/files', (_req, res) => res.json(currentFileTree))

app.get('/api/watch', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  res.write(`data: ${JSON.stringify(currentFileTree)}\n\n`)
  sseClients.add(res)
  req.on('close', () => sseClients.delete(res))
})

const httpServer = createServer(app)

// Data plane: Hocuspocus handles all Yjs WS connections (browsers + watcher)
const wss = new WebSocketServer({ noServer: true })

// Control plane: watcher connects here for file-tree updates and doc-request signals
const watcherWss = new WebSocketServer({ noServer: true })

watcherWss.on('connection', ws => {
  console.log('[watcher] connected')
  watcherWs = ws
  // Replay any docs that were requested before the watcher arrived
  for (const name of requestedDocs) {
    ws.send(JSON.stringify({ type: 'open', name }))
  }
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw)
      if (msg.type === 'filetree') {
        currentFileTree = msg.tree
        const payload = `data: ${JSON.stringify(msg.tree)}\n\n`
        for (const res of sseClients) res.write(payload)
      }
    } catch {}
  })
  ws.on('close', () => {
    if (watcherWs === ws) watcherWs = null
    console.log('[watcher] disconnected')
  })
  ws.on('error', () => {})
})

httpServer.on('upgrade', (request, socket, head) => {
  if (request.url === '/__watcher__') {
    watcherWss.handleUpgrade(request, socket, head, ws => {
      watcherWss.emit('connection', ws)
    })
  } else {
    wss.handleUpgrade(request, socket, head, ws => {
      hocuspocus.handleConnection(ws, request)
    })
  }
})

httpServer.listen(PORT, () => console.log(`relay :${PORT}`))
