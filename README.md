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

The user-facing CLI is maintained in
[monperrus/collab](https://github.com/monperrus/collab); research and
architecture notes are in
[monperrus/collab-notes](https://github.com/monperrus/collab-notes).
