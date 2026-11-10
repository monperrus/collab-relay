import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine,
} from '@codemirror/view'
import { EditorState, Prec } from '@codemirror/state'
import {
  foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap,
} from '@codemirror/language'
import { defaultKeymap } from '@codemirror/commands'
import { gotoLine, highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { lintKeymap } from '@codemirror/lint'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { StreamLanguage } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'

// CodeMirror's `basicSetup` without its undo history. That history records
// every change shown in the editor, including the ones made by the other peers
// and the initial load of the file: enough Ctrl-Z took them all back and
// emptied the document, and the watcher then emptied the file on disk. Undo
// belongs to the Yjs undo manager, which tracks the local user's edits only.
const editorSetup = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
  ]),
]

const params = new URLSearchParams(location.search)
const token = params.get('token')
// Set when the CLI was given a file: the editor shows that file alone.
const singleFile = params.get('file')

if (!token) {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;font-family:'JetBrains Mono','Fira Code','Cascadia Code',monospace;background:#1e1e2e;color:#cdd6f4">
      <div style="max-width:640px">
        <h1 style="font-size:1.4rem;margin-bottom:1rem;color:#cba6f7">Gakoy Collab</h1>
        <p style="line-height:1.6;margin-bottom:1.25rem">
          This is the relay behind <strong>@gakoy/collab</strong>: it shares a local folder for
          real-time, browser-based collaborative editing. Run the CLI against a project on your
          machine and it prints a session URL on this site — send that URL to collaborators to
          edit the same files together while the command keeps running.
        </p>
        <p style="margin-bottom:0.5rem;color:#a6adc8">Install and use:</p>
        <pre style="background:#181825;border:1px solid #313244;border-radius:6px;padding:1rem;overflow-x:auto;line-height:1.6"><code>npx @gakoy/collab ./my-project

# Or install the command once:
npm install --global @gakoy/collab
gakoy-collab ./my-project</code></pre>
        <p style="margin-top:1.25rem;line-height:1.6;color:#a6adc8">
          No session token was found in this URL — open the link the CLI printed instead of this
          bare address. See
          <a href="https://github.com/monperrus/collab" style="color:#89b4fa">github.com/monperrus/collab</a>
          for details.
        </p>
      </div>
    </div>
  `
  throw new Error('no token')
}

const USER_COLORS = [
  '#e57373', '#81c784', '#64b5f6', '#ffb74d',
  '#ba68c8', '#4dd0e1', '#aed581', '#f06292',
]
const userColor = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]
const userName = `User ${Math.floor(Math.random() * 900 + 100)}`

let currentProvider = null
let currentView = null
let currentDoc = null

function langExtension(filename) {
  const ext = filename.split('.').pop().toLowerCase()
  if (['js', 'mjs', 'cjs'].includes(ext)) return javascript()
  if (['ts'].includes(ext)) return javascript({ typescript: true })
  if (['jsx', 'tsx'].includes(ext)) return javascript({ jsx: true, typescript: ext === 'tsx' })
  if (ext === 'py') return python()
  if (['md', 'mdx'].includes(ext)) return markdown()
  if (['html', 'htm'].includes(ext)) return html()
  if (ext === 'css') return css()
  if (ext === 'json') return json()
  if (['tex', 'sty', 'cls', 'bib'].includes(ext)) return StreamLanguage.define(stex)
  return []
}

function openFile(path) {
  if (currentProvider) { currentProvider.destroy(); currentProvider = null }
  if (currentView) { currentView.destroy(); currentView = null }
  if (currentDoc) { currentDoc.destroy(); currentDoc = null }

  document.getElementById('toolbar-path').textContent = path
  document.getElementById('goto-line').disabled = false
  document.getElementById('editor').innerHTML = ''

  const ydoc = new Y.Doc()
  currentDoc = ydoc

  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws'
  // Token is in the path so it becomes part of the Hocuspocus documentName,
  // namespacing the Yjs doc per session.
  const provider = new HocuspocusProvider({
    url: `${wsProto}://${location.host}/${token}/${path}`,
    name: `${token}/${path}`,
    document: ydoc,
  })
  currentProvider = provider

  provider.awareness.setLocalStateField('user', { name: userName, color: userColor })

  const ytext = ydoc.getText('content')
  const undoManager = new Y.UndoManager(ytext)

  const state = EditorState.create({
    extensions: [
      editorSetup,
      // Ctrl-G is Go to Line in VS Code and Sublime Text; it takes precedence
      // over find-next, which stays on F3 (and Cmd-G on macOS).
      Prec.highest(keymap.of([{ key: 'Ctrl-g', run: gotoLine }])),
      oneDark,
      keymap.of(yUndoManagerKeymap),
      langExtension(path),
      yCollab(ytext, provider.awareness, { undoManager }),
      EditorView.lineWrapping,
      EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
    ],
  })

  currentView = new EditorView({
    state,
    parent: document.getElementById('editor'),
  })

  document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'))
  document.querySelector(`.file-item[data-path="${CSS.escape(path)}"]`)?.classList.add('active')
}

function renderTree(nodes, container, depth = 0) {
  container.innerHTML = ''
  for (const node of nodes) {
    if (node.type === 'dir') {
      const toggle = document.createElement('div')
      toggle.className = 'dir-item'
      toggle.style.paddingLeft = `${depth * 12}px`
      toggle.textContent = `▸ ${node.name}`
      container.appendChild(toggle)

      const children = document.createElement('div')
      children.className = 'dir-children'
      renderTree(node.children, children, depth + 1)
      container.appendChild(children)

      let open = true
      toggle.addEventListener('click', () => {
        open = !open
        children.style.display = open ? '' : 'none'
        toggle.textContent = `${open ? '▾' : '▸'} ${node.name}`
      })
    } else {
      const item = document.createElement('div')
      item.className = 'file-item'
      item.style.paddingLeft = `${depth * 12 + 14}px`
      item.textContent = node.name
      item.dataset.path = node.path
      item.addEventListener('click', () => openFile(node.path))
      container.appendChild(item)
    }
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 's' && (e.ctrlKey || e.metaKey)) e.preventDefault()
  // The editor handles Ctrl-G itself when focused; this covers the focus being
  // elsewhere (toolbar, explorer), where the browser would find-next instead.
  if (e.key === 'g' && e.ctrlKey && !e.altKey && !e.metaKey && !e.defaultPrevented && currentView) {
    e.preventDefault()
    gotoLine(currentView)
  }
})

document.getElementById('goto-line').addEventListener('click', () => {
  if (currentView) gotoLine(currentView)
})

if (singleFile) {
  document.getElementById('sidebar').remove()
  document.title = singleFile
  openFile(singleFile)
} else {
  const events = new EventSource(`/api/watch?token=${encodeURIComponent(token)}`)
  events.onmessage = e => {
    const tree = JSON.parse(e.data)
    renderTree(tree, document.getElementById('file-tree'))
  }
  events.onerror = () => {}
}
