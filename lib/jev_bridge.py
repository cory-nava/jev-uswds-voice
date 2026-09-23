#!/usr/bin/env python3
"""Jev bridge: ask TypeSafe's Jev (System One decision model) one evaluation.

Reads a JSON payload from stdin:
    {"state": str, "model": "jev-latest",
     "questions": {"name": {"type": "choice"|"score"|"noul",
                            "instructions": str, "criteria": {...}}}}

POSTs to https://api.typesafe.ai/v1/systemone and prints the parsed
answers JSON to stdout:
    {"answers": {"name": {"choice"|"score"|..., "probabilities": {...},
                          "confidence": float}}, "model": str, "usage": {...}}

Auth: prefers TYPESAFE_API_KEY from the environment (portable); otherwise
uses the stored ``custom.typesafe`` connector via an authd surrogate, which
the sandbox egress swaps for the real key. The surrogate is not the secret
and is never the raw key; nothing secret is printed or logged.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time

TYPESAFE_API_URL = "https://api.typesafe.ai/v1/systemone"
_CONNECTOR_NAME = "custom.typesafe"
_CREDENTIAL_HELPER_PATH = "/opt/hatch/skills/skill-creator/bin/dynamic_credentials.py"
RETRYABLE_STATUS = {429, 529}


def _sanitize_proxy_env() -> None:
    # httpx chokes on bracketed IPv6 literals in no_proxy ("Invalid port").
    for var in ("no_proxy", "NO_PROXY"):
        val = os.environ.get(var)
        if val:
            os.environ[var] = re.sub(r"\[([0-9a-fA-F:]+)\]", r"\1", val)


def _load_credential_helper():
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "dynamic_credentials", _CREDENTIAL_HELPER_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"credential helper not found at {_CREDENTIAL_HELPER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def resolve_bearer_token() -> str:
    env_key = os.environ.get("TYPESAFE_API_KEY")
    if env_key:
        return env_key
    helper = _load_credential_helper()
    helper.ensure_allowed_url(TYPESAFE_API_URL, ["api.typesafe.ai"])
    entry = helper.dynamic_credential_entry(_CONNECTOR_NAME, "access_token")
    return str(entry["surrogate"]).strip()


def post_systemone(payload: dict, bearer: str, timeout: float = 20.0) -> dict:
    import httpx

    headers = {"Authorization": f"Bearer {bearer}", "Content-Type": "application/json"}
    last_error = "unknown"
    for attempt in range(4):
        try:
            with httpx.Client(timeout=timeout, trust_env=True) as client:
                resp = client.post(TYPESAFE_API_URL, headers=headers, json=payload)
            if resp.status_code in RETRYABLE_STATUS:
                last_error = f"HTTP {resp.status_code}"
                time.sleep(1.5 * (attempt + 1))
                continue
            if resp.status_code in (401, 403):
                raise RuntimeError(f"auth rejected (HTTP {resp.status_code})")
            resp.raise_for_status()
            return resp.json()
        except RuntimeError:
            raise
        except Exception as exc:  # network / parse: retry twice, then fail
            last_error = str(exc)
            if attempt < 1:
                time.sleep(1.0)
                continue
            raise RuntimeError(f"jev request failed: {last_error}") from exc
    raise RuntimeError(f"jev request failed after retries: {last_error}")


def main() -> int:
    _sanitize_proxy_env()
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        print(json.dumps({"error": f"invalid stdin JSON: {exc}"}))
        return 2
    if not isinstance(payload, dict) or "state" not in payload or "questions" not in payload:
        print(json.dumps({"error": "payload needs 'state' and 'questions'"}))
        return 2
    payload.setdefault("model", "jev-latest")
    try:
        bearer = resolve_bearer_token()
        data = post_systemone(payload, bearer)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 1
    out = {
        "answers": data.get("answers", {}),
        "model": data.get("model", ""),
        "usage": data.get("usage", {}),
    }
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
