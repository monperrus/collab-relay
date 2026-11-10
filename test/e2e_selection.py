"""End-to-end check that a text selection is visible in the browser editor.

Starts the relay on a free port, opens a single-file session in headless
Chromium, selects text, and checks on the rendered pixels that the selected
area shows the selection colour, on the cursor's line and on other lines,
with and without the editor focused. Exits non-zero on the first failure.

    npm run build && python3 test/e2e_selection.py
"""
from __future__ import annotations

import io
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image
from playwright.sync_api import Page, sync_playwright

RELAY = Path(__file__).resolve().parent.parent
SELECTION = (0x3B, 0x5A, 0x8C)  # .cm-selectionBackground in public/index.html


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


def dominant_colour(page: Page, line: int, word: str) -> tuple[int, int, int]:
    """Most frequent pixel colour over `word` on 1-based `line`: the
    background behind the glyphs, since the glyphs cover few pixels."""
    box = page.evaluate(
        """([line, word]) => {
             const el = document.querySelectorAll('.cm-line')[line - 1]
             const off = el.textContent.indexOf(word)
             const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
             let node, seen = 0
             while ((node = walker.nextNode())) {
               if (off < seen + node.length) break
               seen += node.length
             }
             const r = document.createRange()
             r.setStart(node, off - seen)
             r.setEnd(node, off - seen + word.length)
             const b = r.getBoundingClientRect()
             return { x: b.x, y: b.y, width: b.width, height: b.height }
           }""",
        [line, word],
    )
    png = page.screenshot(clip=box)
    img = Image.open(io.BytesIO(png)).convert("RGB")
    _, colour = max(img.getcolors(img.width * img.height) or [])
    assert isinstance(colour, tuple)
    return (colour[0], colour[1], colour[2])


def close_to(c: tuple[int, int, int], ref: tuple[int, int, int]) -> bool:
    return max(abs(a - b) for a, b in zip(c, ref)) <= 12


def check(name: str, colour: tuple[int, int, int], selected: bool) -> None:
    ok = close_to(colour, SELECTION) == selected
    print(f"{'ok  ' if ok else 'FAIL'} {name} (background #{bytes(colour).hex()})")
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
            page = p.chromium.launch().new_page(color_scheme="dark")
            page.goto(f"{base}/?token=e2e{port}&file=notes.md")
            page.locator(".cm-content").click()
            page.keyboard.insert_text("\n".join(f"alpha bravo line{i}" for i in range(1, 11)))

            # One word on one line: the line is also the cursor's (active) line.
            page.keyboard.press("Control+Home")
            for _ in range(2):
                page.keyboard.press("ArrowDown")
            page.keyboard.press("Home")
            for _ in range(5):
                page.keyboard.press("Shift+ArrowRight")
            check("a word selected on the cursor's line", dominant_colour(page, 3, "alpha"), True)
            check("the unselected word next to it", dominant_colour(page, 3, "bravo"), False)
            check("the same word on another line", dominant_colour(page, 4, "alpha"), False)

            # Several lines: the last one holds the cursor.
            page.keyboard.press("Home")
            for _ in range(3):
                page.keyboard.press("Shift+ArrowDown")
            page.keyboard.press("Shift+End")
            check("a multi-line selection, first line", dominant_colour(page, 3, "bravo"), True)
            check("a multi-line selection, cursor's line", dominant_colour(page, 6, "bravo"), True)

            page.evaluate("document.activeElement.blur()")
            check("an unfocused editor keeps the selection", dominant_colour(page, 6, "bravo"), True)
    finally:
        relay.terminate()


if __name__ == "__main__":
    main()
