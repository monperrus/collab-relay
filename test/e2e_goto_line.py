"""End-to-end check of Go to Line in the browser editor.

Starts the relay on a free port, opens a single-file session in headless
Chromium, fills the document with numbered lines, then jumps with Ctrl-G
(from the editor and from outside it) and with the toolbar button.
Exits non-zero on the first failed check.

    npm run build && python3 test/e2e_goto_line.py
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

RELAY = Path(__file__).resolve().parent.parent
LINES = 200


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_http(url: str) -> None:
    for _ in range(100):
        try:
            urllib.request.urlopen(url, timeout=1)
            return
        except OSError:
            time.sleep(0.1)
    sys.exit(f"relay did not start at {url}")


def cursor_line(page: Page) -> int:
    # The active line gutter marks the line holding the main cursor.
    return int(page.locator(".cm-activeLineGutter").first.inner_text())


def goto(page: Page, value: str) -> None:
    field = page.locator(".cm-panel input[name=line]")
    field.wait_for()
    field.fill(value)
    field.press("Enter")


def check(name: str, ok: bool) -> None:
    print(f"{'ok  ' if ok else 'FAIL'} {name}")
    if not ok:
        sys.exit(1)


def main() -> None:
    port = free_port()
    relay = subprocess.Popen(
        ["node", "server.js"], cwd=RELAY, env={**os.environ, "PORT": str(port)},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        base = f"http://127.0.0.1:{port}"
        wait_http(base)
        with sync_playwright() as p:
            page = p.chromium.launch().new_page()
            page.goto(f"{base}/?token=e2e{port}&file=notes.md")
            page.locator(".cm-content").click()
            page.keyboard.insert_text("\n".join(f"line {i}" for i in range(1, LINES + 1)))
            page.keyboard.press("Control+Home")
            check("cursor starts on line 1", cursor_line(page) == 1)

            page.keyboard.press("Control+g")
            goto(page, "120")
            check("Ctrl-G in the editor jumps to line 120", cursor_line(page) == 120)
            check("the jumped-to line is visible",
                  page.locator(".cm-line", has_text="line 120").first.is_visible())
            check("the editor keeps the focus after the jump",
                  page.evaluate("document.activeElement.classList.contains('cm-content')"))

            page.locator("#toolbar-path").click()
            check("focus left the editor", page.evaluate("document.activeElement === document.body"))
            page.keyboard.press("Control+g")
            goto(page, "42")
            check("Ctrl-G outside the editor jumps to line 42", cursor_line(page) == 42)

            page.locator("#goto-line").click()
            goto(page, "7")
            check("the toolbar button jumps to line 7", cursor_line(page) == 7)

            page.keyboard.press("Control+g")
            goto(page, "9999")
            check("a line past the end clamps to the last line", cursor_line(page) == LINES)
    finally:
        relay.terminate()


if __name__ == "__main__":
    main()
