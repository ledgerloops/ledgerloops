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
