#!/usr/bin/env python3
"""DocTreen conformance runner — Python implementation.

Feeds every case in ../cases through the Python OpenAPI exporter and compares
the result to the case's ``expected/openapi.json``, which was captured from the
Node reference implementation.

Usage::

    python conformance/runners/run_python.py
    DOCTREEN_CONFORMANCE_DIR=/path/to/doctreen/conformance python run_python.py

The fixtures live in the Node repo and are not vendored here; set
``DOCTREEN_CONFORMANCE_DIR`` to a checkout of them (CI shallow-clones it).

Until the exporter lands (Phase 1), the run exits 0 with a loud SKIP **only**
when ``DOCTREEN_CONFORMANCE_ALLOW_SKIP=1`` is set. CI sets it today and must
stop setting it the moment ``doctreen.exporters.openapi`` exists — otherwise
this suite silently passes forever, which is worse than not having it.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
_ENV_DIR = os.environ.get("DOCTREEN_CONFORMANCE_DIR")
CASES_DIR = (Path(_ENV_DIR) / "cases") if _ENV_DIR else (HERE.parent / "cases")


def resolve_named(value: Any, registry: dict[str, Any]) -> Any:
    """Replace every ``{"$named": "X"}`` with the schema registered under X."""
    if isinstance(value, list):
        return [resolve_named(v, registry) for v in value]
    if isinstance(value, dict):
        named = value.get("$named")
        if isinstance(named, str):
            if named not in registry:
                raise KeyError(f"unknown $named reference: {named}")
            return registry[named]
        return {k: resolve_named(v, registry) for k, v in value.items()}
    return value


def first_diff(expected: Any, actual: Any, path: str = "") -> tuple[str, Any, Any] | None:
    """First JSON-pointer path where two documents differ, or None.

    Key order is part of the contract — the docs UI bundle and the golden files
    both depend on it — so object keys are compared as an ordered sequence.
    """
    if type(expected) is not type(actual):
        return (path, expected, actual)
    if isinstance(expected, list):
        if len(expected) != len(actual):
            return (path, f"array({len(expected)})", f"array({len(actual)})")
        for i, (e, a) in enumerate(zip(expected, actual)):
            d = first_diff(e, a, f"{path}/{i}")
            if d:
                return d
        return None
    if isinstance(expected, dict):
        ke, ka = list(expected), list(actual)
        if ke != ka:
            return (path, f"keys{ke}", f"keys{ka}")
        for k in ke:
            d = first_diff(expected[k], actual[k], f"{path}/{k}")
            if d:
                return d
        return None
    return None if expected == actual else (path, expected, actual)


def main() -> int:
    try:
        from doctreen import define_schema, normalize_config  # type: ignore[attr-defined]
        from doctreen.exporters.openapi import build_openapi_document  # type: ignore[import-not-found]
    except ImportError as exc:
        if os.environ.get("DOCTREEN_CONFORMANCE_ALLOW_SKIP") == "1":
            print(f"SKIP: the Python OpenAPI exporter is not implemented yet ({exc}).")
            print("      Unset DOCTREEN_CONFORMANCE_ALLOW_SKIP in CI once it lands.")
            return 0
        print(f"FAIL: cannot import the Python exporter ({exc}).", file=sys.stderr)
        return 2

    dirs = sorted(p for p in CASES_DIR.iterdir() if p.is_dir())
    failed = 0

    for case_dir in dirs:
        spec = json.loads((case_dir / "case.json").read_text(encoding="utf-8"))
        expected = json.loads((case_dir / "expected" / "openapi.json").read_text(encoding="utf-8"))

        registry = {
            name: define_schema(name, node)
            for name, node in (spec.get("namedSchemas") or {}).items()
        }

        try:
            actual = build_openapi_document(
                resolve_named(spec["routes"], registry),
                normalize_config(spec["config"]),
            )
        except Exception as exc:  # noqa: BLE001 — a throw is a conformance failure
            print(f"FAIL  {case_dir.name} — threw: {exc}")
            failed += 1
            continue

        # Round-trip so the comparison sees plain JSON types on both sides.
        diff = first_diff(expected, json.loads(json.dumps(actual)))
        if diff:
            path, exp, act = diff
            print(f"FAIL  {case_dir.name}")
            print(f"      at {path or '<root>'}")
            print(f"      expected: {json.dumps(exp)}")
            print(f"      actual:   {json.dumps(act)}")
            failed += 1
        else:
            print(f"ok    {case_dir.name}")

    print(f"\n{len(dirs) - failed}/{len(dirs)} conformance cases passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
