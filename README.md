# Gakoy Collab Relay

The relay server for [Gakoy Collab](https://github.com/monperrus/collab). It
serves the browser editor and relays Yjs document updates between browsers and
the local `gakoy-collab` watcher.

## Deploy

The production service is deployed as the Dokku app `collab` at
`https://collab.gakoy.com`.

```bash
git push dokku main
```

## Test

The browser editor has end-to-end checks that run the relay locally and
drive headless Chromium (need Python Playwright and Pillow):

```bash
npm run build
python3 test/e2e_goto_line.py
python3 test/e2e_selection.py
```

The user-facing CLI is maintained in
[monperrus/collab](https://github.com/monperrus/collab); research and
architecture notes are in
[monperrus/collab-notes](https://github.com/monperrus/collab-notes).
