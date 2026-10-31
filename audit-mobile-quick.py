#!/usr/bin/env python3
"""Quick mobile viewport audit for KEYFLOWOS.

The login comes from the environment, never from source:
    KEYFLOWOS_AUDIT_EMAIL=... KEYFLOWOS_AUDIT_PASSWORD=... python3 audit-mobile-quick.py
"""
import asyncio
import json
import os
import re
import sys
import traceback
from datetime import datetime, timezone
from urllib.parse import urljoin

# Checked before Playwright is imported, so a missing login stops the run
# before any browser launch, HTTP call or output directory.
EMAIL = os.environ.get("KEYFLOWOS_AUDIT_EMAIL", "")
PASSWORD = os.environ.get("KEYFLOWOS_AUDIT_PASSWORD", "")
_MISSING = [
    name
    for name, value in (("KEYFLOWOS_AUDIT_EMAIL", EMAIL), ("KEYFLOWOS_AUDIT_PASSWORD", PASSWORD))
    if not value
]
if _MISSING:
    print(
        f"audit-mobile-quick.py: {' and '.join(_MISSING)} must be set to the audit "
        "login; refusing to run.",
        file=sys.stderr,
    )
    sys.exit(2)

REDACTED = "[REDACTED]"


def redact(value):
    """Replace the login values with [REDACTED] in a string, list or dict.

    Playwright appends its call log to an error message, and the call log
    line for page.fill repeats the typed value verbatim (fill("<value>")).
    So any error text can hold the password, and
    audit-output/mobile-results.json is a tracked file. Everything printed or
    written passes through here.
    """
    if isinstance(value, str):
        for secret in sorted({PASSWORD, EMAIL}, key=len, reverse=True):
            value = value.replace(secret, REDACTED)
        return value
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        return {key: redact(item) for key, item in value.items()}
    return value


from playwright.async_api import async_playwright, Route  # noqa: E402

BASE_URL = "http://localhost:5000"
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
        login_error = ""
        try:
            await page.fill('input[type="email"]', EMAIL)
            await page.fill('input[type="password"]', PASSWORD)
            await page.click('button[type="submit"]')
        except Exception as e:
            # str(e) ends with Playwright's call log, which repeats the filled value.
            login_error = redact(str(e))
        else:
            try:
                await page.wait_for_url("**/app/**", timeout=15000)
            except Exception:
                await asyncio.sleep(2)

        if login_error or "/app" not in page.url:
            failure = {"step": "login", "status": "failed", "url": page.url}
            if login_error:
                failure["error"] = login_error
            results.append(failure)
            print(f"Login failed: {page.url}" + (f"\n{login_error}" if login_error else ""), flush=True)
            await browser.close()
            with open(os.path.join(OUT_DIR, "mobile-results.json"), "w") as f:
                json.dump(redact(results), f, indent=2)
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
                entry.update({"status": "failed", "error": redact(str(e)), "url": page.url, "errors": list(console_errors), "screenshot": path})
                console_errors.clear()
                print(f"{route} FAILED: {redact(str(e))}", flush=True)
            results.append(entry)
            await asyncio.sleep(2)

        await browser.close()

    results = redact(results)
    with open(os.path.join(OUT_DIR, "mobile-results.json"), "w") as f:
        json.dump(results, f, indent=2)
    print(json.dumps(results, indent=2), flush=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        # An uncaught Playwright error's traceback carries its call log.
        sys.stderr.write(redact(traceback.format_exc()))
        sys.exit(1)
