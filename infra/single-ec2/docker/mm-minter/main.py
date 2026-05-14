"""Server-side Mattermost session minter.

Anonymous portfolio visitors land on /mattermost/. Nginx proxies that exact
path here. We log in to Mattermost as a fixed demo user using credentials from
the container's env vars (NEVER served HTML), then set the MM session cookies
on the visitor's response and 302 them to the configured landing channel.

The demo token is cached in-process so concurrent visitors don't each trigger
a new MM login. Mattermost sessions are long-lived (>30 days by default); we
refresh well before that.
"""

from __future__ import annotations

import html
import json
import logging
import os
import time

import httpx
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("mm-minter")

MM_INTERNAL = os.environ["MM_INTERNAL_URL"]
MM_LOGIN_ID = os.environ["MM_DEMO_LOGIN_ID"]
MM_PASSWORD = os.environ["MM_DEMO_PASSWORD"]
DEFAULT_NEXT = os.environ.get(
    "MM_DEFAULT_NEXT", "/mattermost/engineering/channels/Engineering"
)
TOKEN_TTL_S = 12 * 60 * 60
COOKIE_MAX_AGE_S = 24 * 60 * 60

app = FastAPI()
_cache: dict[str, object] = {"token": None, "user_id": None, "exp": 0.0}


def _login() -> tuple[str, str]:
    if _cache["token"] and time.time() < float(_cache["exp"]):  # type: ignore[arg-type]
        return str(_cache["token"]), str(_cache["user_id"])
    url = f"{MM_INTERNAL}/api/v4/users/login"
    log.info("mm_login.request url=%s login_id=%s", url, MM_LOGIN_ID)
    r = httpx.post(
        url,
        json={"login_id": MM_LOGIN_ID, "password": MM_PASSWORD},
        timeout=10.0,
    )
    if r.status_code >= 400:
        log.error(
            "mm_login.upstream_error status=%s body=%s",
            r.status_code,
            r.text[:500],
        )
    r.raise_for_status()
    token = r.headers.get("Token")
    if not token:
        log.error("mm_login.missing_token headers=%s", dict(r.headers))
        raise httpx.HTTPError("Mattermost did not return a Token header")
    user_id = r.json()["id"]
    _cache.update(token=token, user_id=user_id, exp=time.time() + TOKEN_TTL_S)
    log.info("mm_login.success user_id=%s", user_id)
    return token, user_id


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


_STUB_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Loading Mattermost…</title>
<meta name="robots" content="noindex">
<style>
html,body{{margin:0;height:100%;background:#1e325c;color:#fff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;
display:flex;align-items:center;justify-content:center}}
.spinner{{width:32px;height:32px;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;
animation:spin .8s linear infinite}}
@keyframes spin{{to{{transform:rotate(360deg)}}}}
</style>
</head>
<body>
<div class="spinner" aria-label="Loading"></div>
<script>
// Set MM's mobile-splash-seen flag in localStorage (cookie was set in the
// response headers above). localStorage is origin-scoped so MM's React bundle,
// which runs on the same origin, will read this value and skip the splash.
try {{ localStorage.setItem('__landingPageSeen__', 'true'); }} catch (e) {{}}
location.replace({next_js});
</script>
<noscript><meta http-equiv="refresh" content="0; url={next_attr}"></noscript>
</body>
</html>
"""


@app.get("/mint")
def mint(next: str = DEFAULT_NEXT):
    # Whitelist `next` to /mattermost/ to prevent open-redirect abuse.
    if not next.startswith("/mattermost/"):
        next = DEFAULT_NEXT
    try:
        token, user_id = _login()
    except httpx.HTTPError as e:
        # Drop the cached token so the next request retries cleanly.
        _cache.update(token=None, user_id=None, exp=0.0)
        log.exception("mm_login.failed err=%s", e)
        return JSONResponse(
            {"error": "mattermost upstream unavailable"}, status_code=502
        )
    body = _STUB_HTML.format(
        next_js=json.dumps(next),       # safe for the inline <script>
        next_attr=html.escape(next, quote=True),  # safe for the noscript meta
    )
    resp = HTMLResponse(content=body, status_code=200)
    cookie_kwargs = dict(
        path="/mattermost",
        max_age=COOKIE_MAX_AGE_S,
        secure=True,
        samesite="lax",
    )
    # MMAUTHTOKEN is the session; MMUSERID is what MM's React bundle reads to
    # bootstrap. HttpOnly on the token prevents JS exfil; user-id has no auth
    # weight on its own so it's readable.
    resp.set_cookie("MMAUTHTOKEN", token, httponly=True, **cookie_kwargs)  # type: ignore[arg-type]
    resp.set_cookie("MMUSERID", user_id, **cookie_kwargs)  # type: ignore[arg-type]
    # Belt-and-braces alongside the localStorage flag set in the stub script:
    # cookie is consulted on some MM code paths, localStorage on others.
    resp.set_cookie(
        "MMUSERAGREEDTOOPENINBROWSER",
        "true",
        path="/mattermost",
        max_age=31_536_000,
        secure=True,
        samesite="lax",
    )
    return resp
