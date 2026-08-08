#!/usr/bin/env python3
"""Quick mobile viewport audit for KEYFLOWOS."""
import asyncio
import json
import os
from datetime import datetime, timezone
from urllib.parse import urljoin

from playwright.async_api import async_playwright, Route
import re

BASE_URL = "http://localhost:5000"
EMAIL = "keyflowos.tt@gmail.com"
PASSWORD = "S@chin1997"
OUT_DIR = "audit-output"

ROUTES = [
    "/app/command-center",
    "/app/key/chat",
    "/app/temporal-flow",
    "/app/genome",
    "/app/settings",
]

os.makedirs(OUT_DIR, exist_ok=True)


async def handle_route(route: Route):
    url = route.request.url
    if re.search(r"/ai/businesses/[^/]+/flow/sessions", url):
        await route.fulfill(status=200, content_type="application/json", body=json.dumps({"sessions": []}))
        return
    await route.continue_()


async def main():
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 390, "height": 844, "device_scale_factor": 2})
        page = await context.new_page()
        await page.route("**/*", handle_route)

        console_errors = []
        page.on("console", lambda msg: msg.type == "error" and console_errors.append({"text": msg.text}))
        page.on("pageerror", lambda exc: console_errors.append({"type": "pageerror", "text": str(exc)}))

        print("Logging in on mobile...", flush=True)
        await page.goto(urljoin(BASE_URL, "/auth/login"), wait_until="load")
        await page.fill('input[type="email"]', EMAIL)
        await page.fill('input[type="password"]', PASSWORD)
        await page.click('button[type="submit"]')
        try:
            await page.wait_for_url("**/app/**", timeout=15000)
        except Exception:
            await asyncio.sleep(2)

        if "/app" not in page.url:
            results.append({"step": "login", "status": "failed", "url": page.url})
            print(f"Login failed: {page.url}", flush=True)
            await browser.close()
            with open(os.path.join(OUT_DIR, "mobile-results.json"), "w") as f:
                json.dump(results, f, indent=2)
            return

        print(f"Login success: {page.url}", flush=True)
        results.append({"step": "login", "status": "success", "url": page.url})

        for route in ROUTES:
            print(f"Navigating to {route}...", flush=True)
            entry = {"route": route, "started_at": datetime.now(timezone.utc).isoformat()}
            try:
                await page.goto(urljoin(BASE_URL, route), wait_until="load", timeout=45000)
                await asyncio.sleep(3)
                title = await page.title()
                path = os.path.join(OUT_DIR, f"{route.replace('/', '_').strip('_')}-mobile.png")
                await page.screenshot(path=path, full_page=True)
                entry.update({"status": "success", "title": title, "url": page.url, "errors": list(console_errors), "screenshot": path})
                console_errors.clear()
                print(f"{route} -> {page.url} OK", flush=True)
            except Exception as e:
                path = os.path.join(OUT_DIR, f"{route.replace('/', '_').strip('_')}-mobile-timeout.png")
                try:
                    await page.screenshot(path=path, full_page=True)
                except Exception:
                    path = None
                entry.update({"status": "failed", "error": str(e), "url": page.url, "errors": list(console_errors), "screenshot": path})
                console_errors.clear()
                print(f"{route} FAILED: {e}", flush=True)
            results.append(entry)
            await asyncio.sleep(2)

        await browser.close()

    with open(os.path.join(OUT_DIR, "mobile-results.json"), "w") as f:
        json.dump(results, f, indent=2)
    print(json.dumps(results, indent=2), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
