#!/usr/bin/env python3
"""
KEYFLOWOS audit script.
Logs in, visits key modules, captures console errors, screenshots, and network failures.
"""
import asyncio
import json
import os
import re
import sys
from datetime import datetime, timezone
from urllib.parse import urljoin

from playwright.async_api import async_playwright, Route, Request

BASE_URL = "http://localhost:5000"
API_URL = "http://localhost:3001"
EMAIL = "keyflowos.tt@gmail.com"
PASSWORD = "S@chin1997"
OUT_DIR = "audit-output"

# Mix of legacy URLs (to verify redirects) and canonical URLs (to test real pages).
ROUTES = [
    "/app/command-center",
    "/app/key/chat",
    "/app/commerce",
    "/app/money/revenue",
    "/app/temporal-flow",
    "/app/genome",
    "/app/crm",
    "/app/people-flow",
    "/app/finance",
    "/app/money",
    "/app/schedule/calendar",
    "/app/calendar",
    "/app/settings",
    "/app/build/system/workspace",
    "/app/store",
    "/app/events",
    "/app/portal",
    "/app/communicate/campaigns",
]

VIEWPORTS = {
    "desktop": {"width": 1280, "height": 800},
    "mobile": {"width": 390, "height": 844, "device_scale_factor": 2},
}

os.makedirs(OUT_DIR, exist_ok=True)


def safe_filename(route: str, viewport: str) -> str:
    base = route.replace("/", "_").strip("_") or "root"
    return f"{base}-{viewport}"


async def audit_viewport(browser, viewport_name: str, viewport: dict, results: list):
    context = await browser.new_context(viewport=viewport)
    page = await context.new_page()

    console_errors = []
    failed_requests = []
    navigations = []

    async def handle_route(route: Route):
        url = route.request.url
        if re.search(r"/ai/businesses/[^/]+/flow/sessions", url):
            await route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"sessions": []}),
            )
            return
        await route.continue_()

    def handle_console(msg):
        if msg.type == "error":
            console_errors.append({"type": msg.type, "text": msg.text, "location": str(msg.location)})

    def handle_request(req: Request):
        url = req.url
        if url.startswith(("http://localhost:3001/", "http://localhost:5000/")):
            asyncio.create_task(_record_failed(req))

    async def _record_failed(req: Request):
        try:
            resp = await req.response()
            if resp and resp.status >= 400:
                failed_requests.append({"url": req.url, "status": resp.status, "method": req.method})
        except Exception:
            pass

    def handle_frame_navigated(frame):
        if frame == page.main_frame and frame.url.startswith(BASE_URL):
            navigations.append(frame.url)

    page.on("console", handle_console)
    page.on("pageerror", lambda exc: console_errors.append({"type": "pageerror", "text": str(exc)}))
    page.on("request", handle_request)
    page.on("framenavigated", handle_frame_navigated)
    await page.route("**/*", handle_route)

    print(f"[{viewport_name}] Logging in...", flush=True)
    await page.goto(urljoin(BASE_URL, "/auth/login"), wait_until="load")
    await page.screenshot(path=os.path.join(OUT_DIR, f"login-page-{viewport_name}.png"))

    try:
        await page.fill('input[type="email"]', EMAIL)
        await page.fill('input[type="password"]', PASSWORD)
        await page.click('button[type="submit"]')
        try:
            await page.wait_for_url("**/app/**", timeout=15000)
        except Exception:
            await asyncio.sleep(2)
        current_url = page.url
        error_text = ""
        try:
            error_el = await page.wait_for_selector('[class*="text-red"]', timeout=2000)
            error_text = await error_el.inner_text() if error_el else ""
        except Exception:
            pass
        if "/app" not in current_url or error_text:
            raise Exception(f"Login did not redirect to /app. URL={current_url}, error={error_text}")
    except Exception as e:
        results.append({"step": "login", "status": "failed", "viewport": viewport_name, "error": str(e)})
        await page.screenshot(path=os.path.join(OUT_DIR, f"login-failed-{viewport_name}.png"))
        await page.close()
        await context.close()
        return False

    print(f"[{viewport_name}] Login success: {page.url}", flush=True)
    results.append({"step": "login", "status": "success", "viewport": viewport_name, "url": page.url})

    for route in ROUTES:
        route_errors = []
        entry = {
            "route": route,
            "viewport": viewport_name,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        navigations.clear()
        print(f"[{viewport_name}] Navigating to {route}...", flush=True)
        try:
            await page.goto(urljoin(BASE_URL, route), wait_until="load", timeout=45000)
            await asyncio.sleep(3)
            title = await page.title()
            screenshot_path = os.path.join(OUT_DIR, f"{safe_filename(route, viewport_name)}.png")
            await page.screenshot(path=screenshot_path, full_page=True)
            route_errors = list(console_errors)
            console_errors.clear()
            entry.update({
                "status": "success",
                "title": title,
                "url": page.url,
                "errors": route_errors,
                "failed_requests": list(failed_requests),
                "navigations": list(navigations),
                "screenshot": screenshot_path,
            })
            print(f"[{viewport_name}] {route} -> {page.url} OK", flush=True)
        except Exception as e:
            route_errors = list(console_errors)
            console_errors.clear()
            screenshot_path = os.path.join(OUT_DIR, f"{safe_filename(route, viewport_name)}-timeout.png")
            try:
                await page.screenshot(path=screenshot_path, full_page=True)
            except Exception:
                screenshot_path = None
            entry.update({
                "status": "failed",
                "error": str(e),
                "url": page.url,
                "errors": route_errors,
                "failed_requests": list(failed_requests),
                "navigations": list(navigations),
                "screenshot": screenshot_path,
            })
            print(f"[{viewport_name}] {route} FAILED: {e}", flush=True)
        failed_requests.clear()
        results.append(entry)
        await asyncio.sleep(2)

    await page.close()
    await context.close()
    return True


async def main():
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        for viewport_name, viewport in VIEWPORTS.items():
            await audit_viewport(browser, viewport_name, viewport, results)

        await browser.close()

    out_path = os.path.join(OUT_DIR, "results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)

    print(json.dumps(results, indent=2), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
