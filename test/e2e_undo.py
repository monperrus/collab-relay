"""End-to-end check that undo only reverts the user's own edits.

Starts the relay on a free port and opens one single-file session in two
headless Chromium pages. The first page, standing for the watcher loading the
file from disk (or any other peer), writes the paper; the second one types a
word, then presses Ctrl-Z far more times than it made edits. Undo must take
back that word and nothing else: the text another peer wrote is not the
user's to undo, and deleting it would delete the file on disk.
Exits non-zero on the first failed check.

    npm run build && python3 test/e2e_undo.py
"""
from __future__ import annotations

import os
import subprocess
import sys

from playwright.sync_api import Page, sync_playwright

from e2e_goto_line import RELAY, check, free_port, wait_http

PAPER = "\n".join(f"paragraph {i} of the paper" for i in range(1, 11))
UNDO_PRESSES = 200


# The relay serves the documents of a session only while its watcher holds
# the control socket; this one holds it and does nothing else.
FAKE_WATCHER = """
const WebSocket = require('ws')
const ws = new WebSocket(process.argv[1])
ws.on('open', () => console.log('connected'))
"""


# The text of the document as displayed, without the carets and name tags
# drawn for the other peers.
DISPLAYED_TEXT = """() => [...document.querySelectorAll('.cm-line')].map(line => {
  const copy = line.cloneNode(true)
  copy.querySelectorAll('.cm-ySelectionCaret').forEach(caret => caret.remove())
  return copy.textContent.replace(/\\u2060/g, '')
}).join('\\n')"""


def wait_text(page: Page, expected: str) -> bool:
    try:
        page.wait_for_function(f"e => ({DISPLAYED_TEXT})() === e", arg=expected, timeout=5000)
        return True
    except Exception:
        return False


def main() -> None:
    port = free_port()
    relay = subprocess.Popen(
        ["node", "server.js"], cwd=RELAY, env={**os.environ, "PORT": str(port)},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        base = f"http://127.0.0.1:{port}"
        wait_http(base)
        token = f"e2e{port}"
        url = f"{base}/?token={token}&file=paper.tex"
        watcher = subprocess.Popen(
            ["node", "-e", FAKE_WATCHER, f"ws://127.0.0.1:{port}/__watcher__?token={token}"],
            cwd=RELAY, stdout=subprocess.PIPE, text=True,
        )
        if watcher.stdout.readline().strip() != "connected":
            sys.exit("fake watcher could not connect")
        with sync_playwright() as p:
            browser = p.chromium.launch()
            peer, user = browser.new_page(), browser.new_page()

            peer.goto(url)
            peer.locator(".cm-content").click()
            peer.keyboard.insert_text(PAPER)

            user.goto(url)
            check("the user sees the paper written by the peer", wait_text(user, PAPER))

            user.locator(".cm-content").click()
            user.keyboard.press("Control+End")
            user.keyboard.insert_text(" EDIT")
            check("the user's edit is applied", wait_text(user, PAPER + " EDIT"))

            for _ in range(UNDO_PRESSES):
                user.keyboard.press("Control+z")
            check("undo reverts the user's edit and keeps the paper", wait_text(user, PAPER))
            check("the peer still has the paper", wait_text(peer, PAPER))

            # Capital Z: a real keyboard reports "Z" with Shift held, and
            # CodeMirror reads a lowercase "z" with Shift as plain Ctrl-z.
            for redo in ("Control+y", "Control+Shift+Z"):
                user.keyboard.press(redo)
                check(f"{redo} brings the user's edit back", wait_text(user, PAPER + " EDIT"))
                check(f"the {redo} redo reaches the peer", wait_text(peer, PAPER + " EDIT"))
                user.keyboard.press("Control+z")
                check("undo takes it back again", wait_text(user, PAPER))
        watcher.terminate()
    finally:
        relay.terminate()


if __name__ == "__main__":
    main()
