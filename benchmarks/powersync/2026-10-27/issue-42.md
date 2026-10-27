# PowerSync benchmark plan

Status: ready for worker assignment; not launched.

Use the shared contract and exact fixture generator embedded below. Verify the manifest before adapting data.

Use official current self-hosted PowerSync plus local Postgres and a supported persistent SDK. Record source database setup and edition/licensing requirements. Ensure the sender's bucket/stream state is prepared before timing.
Compare (1) 132 rows in issues/notes tables with typed scalar columns and nested JSON/text columns, (2) 132 rows with complete record JSON, and (3) two collection-document rows containing full collection JSON, if supported. Preserve all fields and reconstruct the fixture. Explain row-based replication versus JSON column update granularity, sync rules/streams and row-level authorization. Await the SDK's real full-checkpoint synchronization and confirmed persistence, not merely a first query result. Capture SQLite receiver disk and required service/Postgres data separately. Do not reuse a published benchmark as a measured result.

Deliver: modeling comparison, adapter code and pinned dependencies, commands, environment record, raw measurements + summary, wire bytes, disk totals/baselines, round-trip correctness evidence and limitations. Record unsupported variants explicitly.


## Acceptance checklist

- [ ] Document supported modeling granularities and trade-offs.
- [ ] Generate and verify the exact synthetic fixture.
- [ ] Implement real loopback replication into a fresh persistent receiver.
- [ ] Run warmups and 10 measured transfers per supported model.
- [ ] Verify complete content after receiver reopen.
- [ ] Measure readable time, durable time, wire bytes, receiver disk baseline and total, and separate service disk.
- [ ] Measure issue-title and note-body incremental changes.
- [ ] Supply pinned dependencies, runnable adapter, environment, raw results and limitations.

# Shared benchmark contract

Use only the synthetic generator embedded below generate_fixture.py; never use the user's laptop databases, records, account keys, or private snapshots.

Dataset: deterministic v1 fixture, 21 issues + 111 notes, complete nested content, about 415 KB compact JSON. The manifest identifies the exact bytes and SHA-256. Keep all fields and JSON nulls, array order, and IDs. Do not fetch example.invalid URLs or invent attachment contents. Reconstruction of the complete fixture is the correctness criterion; the record count alone is insufficient.

Prepare the sender fully and open a fresh receiver database before timing. Establish the transport first; report connection/authentication time separately. Start the main timer immediately before the receiver requests/subscribes to the full dataset. Stop at confirmed durable persistence of all payload, required metadata, and indexes. Also report the earlier readable/observable time. Document exactly what the SDK's persistence acknowledgement guarantees; if no durable acknowledgement is available, mark that timing as weaker and do not rank it as equivalent. Closing/reopening must verify the complete reconstructed fixture; this is required but does not alone prove power-loss durability.

Use actual engine replication over loopback with the engine's normal authorization and integrity checks. Do not substitute HTTP download + direct SQLite inserts for replication. Do not count optimistic local writes or a partial page as full initial sync. Use native persistence when supported; if browser-only, record browser, IndexedDB/OPFS choice, and persistence boundary. Separate process/client/sender startup and schema/fixture preparation from transfer and persistence.

Run 3 warmup transfers and 10 measured transfers, each into a fresh persistent receiver. Verify and reopen each measured receiver outside the timer. Record raw times, p50, p95, and maximum; do not infer p95 from too few runs without identifying the sample count. A slow engine still runs the same count unless resource limits prevent it, which must be reported.

After initial sync, measure a one-field issue title change and then a one-field note body change, with the receiver already subscribed. Include changed bytes and convergence times; verify the changed fixture. This reveals coarse-grained update costs hidden by the initial-load benchmark.

Measure received application-level wire bytes; distinguish raw protocol bytes and compressed transport bytes, and state what instrumentation excludes. Measure per-variant initialized-empty and post-sync receiver disk sizes after documented flush/close. Report apparent file bytes and allocated bytes, both totals and net growth. Include receiver-owned history, indexes, WAL/logs, and metadata. Report compaction separately; do not silently compact one engine only. Record required server/sender disk usage separately. Do not include executables, node_modules, Rust targets, Docker images, or entire browser profiles as data storage. Never subtract a baseline without also reporting both actual totals.

Pin package versions/repository commits and produce reproducible install/run commands, lockfiles, adapter source, result JSON, and a short report. Record UTC date, OS/kernel, architecture, CPU model, vCPU count/quota, RAM/cgroup limit, filesystem and storage path, browser/runtime versions, container details, engine topology, durability mode and indexes. One cloud worker per engine is organizational separation, not proof of equal hardware; cross-worker rankings are provisional until runners are matched or adapters rerun on one host.

Consult current primary documentation and source. Verify real durability APIs and data models rather than assuming marketing claims. Use synthetic test identities only. Self-host services locally within the worker; do not upload to a vendor cloud or use paid accounts, personal credentials, or external production services. Do not change default durability or integrity checks to hit a latency target. Unsupported models, licensing restrictions, unavailable binaries, and resource limits are findings: show the exact blocker and leave the cell unmeasured rather than fabricate numbers.

Save only synthetic fixture, code and aggregate results as deliverables; do not publish upstream changes or open PRs for benchmark-only work. A managed-cloud worker must read its cloud-environment runtime instructions and applicable repository AGENTS.md before setup. Avoid modifying engine internals for the primary comparisons; optional optimized forks must be separate variants.


## Exact fixture manifest

```json
{
  "version": "sync-engine-comparison-v1",
  "records": 132,
  "issues": 21,
  "notes": 111,
  "bytes": 415448,
  "sha256": "9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a",
  "collection_bytes": {
    "issues": 83224,
    "notes": 332204
  },
  "content": "entirely synthetic; no personal source data"
}
```

## Self-contained fixture generator

Save the following as `generate_fixture.py`, then run `python3 generate_fixture.py fixture`. This is identical across all six engine issues. The generator itself uses only the Python standard library.

```python
#!/usr/bin/env python3
"""Generate public, deterministic, entirely synthetic sync-benchmark inputs."""
import hashlib
import json
from pathlib import Path
import sys

SEED = "sync-engine-comparison-v1"
WORDS = ("amber birch cloud delta ember fern grove harbor iris juniper kite lake "
         "maple north olive pine quartz river stone tide umber valley willow "
         "xenon yellow zephyr build review draft archive plan meeting release "
         "garden travel design service window project record sample account "
         "collection label issue note content detail task update document").split()

def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()

def text(key, length):
    parts, size, counter = [], 0, 0
    while size < length:
        block = hashlib.sha256(f"{SEED}:{key}:{counter}".encode()).digest()
        for number in block:
            word = WORDS[number % len(WORDS)] + " "
            parts.append(word)
            size += len(word)
        counter += 1
    return "".join(parts)[:length]

def fill(records, target):
    # Allocate text evenly. No single giant padding record; all source text is ASCII.
    remainder = target - len(encoded(records))
    if remainder < 0:
        raise ValueError("Metadata exceeds requested size")
    share, extra = divmod(remainder, len(records))
    for i, record in enumerate(records):
        record["body"] = text(record["id"], share + (i < extra))
    assert len(encoded(records)) == target
    return records

def generate():
    issues = []
    for i in range(21):
        user = {"id": f"user-{i % 7}", "login": f"developer-{i % 7}",
                "url": f"https://example.invalid/users/{i % 7}"}
        issues.append({
            "id": f"issue-{i:03}", "number": i + 1,
            "title": f"Synthetic issue {i + 1}: {text(f'title-{i}', 35)}",
            "body": "", "state": "closed" if i % 4 == 0 else "open",
            "created_at": "2026-01-01T12:00:00Z", "updated_at": "2026-01-02T12:00:00Z",
            "closed_at": "2026-01-02T12:00:00Z" if i % 4 == 0 else None,
            "user": user, "assignees": [user] if i % 3 else [],
            "labels": [{"id": "label-1", "name": "synthetic", "color": "abcdef"},
                       {"id": f"label-{2 + i % 3}", "name": f"area-{i % 3}", "color": "123456"}],
            "repository": {"id": "repo-1", "name": "synthetic-tracker",
                           "owner": {"id": "org-1", "login": "example-org"}},
            "comments": [{"id": f"comment-{i}-{j}", "author": user,
                          "body": text(f'comment-{i}-{j}', 90)} for j in range(i % 4)],
            "url": f"https://example.invalid/issues/{i + 1}",
            "milestone": {"id": "milestone-1", "title": "Demo release"} if i % 2 else None,
        })
    notes = []
    for i in range(111):
        notes.append({
            "id": f"note-{i:03}", "title": f"Synthetic note {i + 1}", "body": "",
            "created_at": "2026-01-01T12:00:00Z", "updated_at": "2026-01-02T12:00:00Z",
            "archived": i % 7 == 0, "pinned": i % 9 == 0,
            "labels": [f"topic-{i % 5}", "synthetic"],
            "checklist": [{"id": f"check-{i}-{j}", "text": f"Synthetic task {j + 1}",
                           "checked": j % 2 == 0} for j in range(i % 6)],
            "attachments": [{"id": f"attachment-{i}", "name": "example.txt",
                             "mime_type": "text/plain", "size": 0,
                             "url": f"https://example.invalid/files/{i}"}] if i % 8 == 0 else [],
            "reminder": {"at": "2026-02-01T12:00:00Z", "timezone": "UTC"} if i % 5 == 0 else None,
            "collaborators": [{"id": "user-1", "email": "person@example.invalid"}] if i % 3 else [],
        })
    # Match the earlier compact source magnitudes, without using source content.
    return {"issues": fill(issues, 83224), "notes": fill(notes, 332204)}

def main():
    output = Path(sys.argv[1] if len(sys.argv) > 1 else "fixture")
    output.mkdir(parents=True, exist_ok=True)
    data = generate()
    blob = encoded(data)
    (output / "fixture.json").write_bytes(blob)
    manifest = {"version": SEED, "records": 132, "issues": 21, "notes": 111,
                "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest(),
                "collection_bytes": {key: len(encoded(value)) for key, value in data.items()},
                "content": "entirely synthetic; no personal source data"}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))

if __name__ == "__main__":
    main()
```
