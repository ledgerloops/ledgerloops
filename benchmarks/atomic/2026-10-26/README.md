# Atomic synthetic sync benchmark

This bundle contains the verified Model H measurements from 2026-10-26 for [issue 41](https://github.com/ledgerloops/ledgerloops/issues/41). Start with [REPORT.md](REPORT.md).

The original task's `outputs/` layout is preserved so its runner resolves the external harness, fixture and summaries correctly. From this dated directory:

```sh
python3 outputs/generate_fixture.py outputs/fixture
python3 outputs/with_measurement_lock.py python3 outputs/run.py
```

Prerequisites are Python 3, Git, Cargo/Rust and the configured shared coordination directory. The measurement used Rust 1.99.1. Dependencies are pinned by [Cargo.lock](outputs/harness/Cargo.lock); engine source is pinned to `396f0da075bd514e2c46b2fa33a575b35c14b2a6`. Each invocation prepares a new synthetic identity and sender, creates 13 fresh persistent receivers and runs two live field changes. No existing service or data store is required. Compilation, dependency downloads, sender preparation and receiver startup are excluded from transfer timing.

`run.py` creates its runtime, Cargo home, target, engine source and stores in a dedicated `/private/tmp/atomic-sync-model-h-*` directory. It reads only library source from the optional pinned checkout named in the script; otherwise it clones the public engine repository at the same pin. The harness remains outside engine source. No engine features are changed.

On another machine, configure `LOCK` in [with_measurement_lock.py](outputs/with_measurement_lock.py) and create its parent directory before running. All cooperating benchmark workers must use that same lock. The wrapper acquires with atomic mkdir, waits up to 30 minutes, and releases only its own token. The recorded laptop coordination path uses the current home directory rather than a personal username.

Recompute statistics from the published completed run without rerunning the benchmark:

```sh
python3 outputs/summarize.py outputs/model-h-20261026T063214Z
```

The raw results contain warmups 1–3 and measured transfers 4–13. Each `verification-*.json` records exact native state/index/envelope comparison after reopening. Fixture bytes remain unchanged and hash to `9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a`. [Original run notes](outputs/README.txt) describe measurement details and primary source references.

No database files, build products or temporary secrets are included. A rerun's temporary owner secret stays in its runtime directory and should be removed after completing that run. See [PUBLICATION.md](PUBLICATION.md) for the limited publication changes.
