"""Screenshot the voice console and generated pages against the prod server."""
from playwright.sync_api import sync_playwright

CHROME = "/home/hatch/workspace/tooling/chrome-linux64/chrome"
BASE = "http://localhost:3100"
OUT = "/home/hatch/workspace/jev-uswds-voice/screenshots"

import os
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    pg = browser.new_page(viewport={"width": 1440, "height": 900})
    for route in ["voice", "marketing", "signin", "dashboard", "profile"]:
        pg.goto(f"{BASE}/{route}", wait_until="networkidle")
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f"{OUT}/{route}.png", full_page=(route != "voice"))
        print("shot", route)
    browser.close()
print("done")
