#!/usr/bin/env python3
"""Render a concise measured report, keeping the limitations beside the data."""
import json, pathlib
p=pathlib.Path(__file__).resolve().parent
raw=json.loads((p/'measured-results.json').read_text())
s=json.loads((p/'measured-summary.json').read_text())
env=raw['environments'][0]
names={'records':'132 records','shared':'Records + shared objects','collections':'2 collections'}
def f(x):return f'{x:.2f}'
def n(x):return f'{x:,.0f}'
text='''# Replicache synthetic sync benchmark

Completed the three modeling variants in [ledgerloops/ledgerloops#43](https://github.com/ledgerloops/ledgerloops/issues/43):
3 warmups + 10 measured fresh persistent receivers per model (39 total). Each receiver
performed initial sync, one issue-title update and one note-body update. All 117
phases passed complete canonical-content comparison after browser close/reopen,
with replication blocked during verification. The exact original fixture hash is
`9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a`
(415,448 bytes; 21 issues and 111 notes). Every source field, null and array order
was preserved. All identities and content are synthetic.

The official Replicache client uses its normal HTTP pull protocol against a prepared
loopback server. No file copying or direct receiver inserts deliver data. Sender
preparation, browser/client startup and authenticated connection setup are outside
the timer. The receiver is open and subscribed before every timed pull.

| Model | Keys | Initial observable p50 ms | p95 / maximum ms | Initial persistence notification p50 ms |
|---|---:|---:|---:|---:|
'''
for model,v in s['models'].items():
 st=v['stages']['initial']
 text+=f"| {names[model]} | {v['key_count']} | {f(st['observable_ms']['p50'])} | {f(st['observable_ms']['p95_nearest_rank'])} | {f(st['persistence_notification_ms']['p50'])} |\n"
text+='''
p50 is the median; p95 uses nearest rank with **n=10**, so it equals the sample
maximum here. These are small exploratory samples on a shared laptop.

**Confirmed power-loss durable time is unavailable (`durable_ms: null`).**
Replicache 15.3.0 has no public persistence acknowledgement and uses relaxed
IndexedDB transactions. The separate persistence column passively observes the
engine's existing BroadcastChannel notification after its default background
persist and IndexedDB transaction completion. This internal observation includes
message-delivery overhead and is weaker than an fsync durability barrier.
Successful reopen proves the tested persistence round trip, not power-loss durability.
See the [pinned IndexedDB store](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/kv/idb-store.ts)
and [persistence implementation](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/replicache-impl.ts).

| Model | Initial received bytes | Title update bytes | Title observable p50 / p95 ms | Note update bytes | Note observable p50 / p95 ms |
|---|---:|---:|---:|---:|---:|
'''
for model,v in s['models'].items():
 a,b,c=[v['stages'][k] for k in ['initial','issue_title','note_body']]
 text+=f"| {names[model]} | {n(a['received_protocol_bytes']['p50'])} | {n(b['received_protocol_bytes']['p50'])} | {f(b['observable_ms']['p50'])} / {f(b['observable_ms']['p95_nearest_rank'])} | {n(c['received_protocol_bytes']['p50'])} | {f(c['observable_ms']['p50'])} / {f(c['observable_ms']['p95_nearest_rank'])} |\n"
text+='''
Wire counts are exact received JSON protocol bodies, independently matched by CDP
for every phase. Transport uses identity encoding, so compressed and uncompressed
body counts coincide. HTTP headers are excluded from this table and recorded in a
separate CDP encoded-byte count; TCP/IP framing, readiness and startup are excluded.
Cookies transition null→1→2→3, and incremental patches contain only the changed key.
The source title gains 25 ASCII bytes and the note body gains 29 ASCII bytes.
Replicache's `put` patch replaces a key's entire JSON value; the collection model
therefore retransmits an entire collection for a one-field change. All raw update
and persistence timing samples are retained in the result JSON.

Replicache exposes JSON key/value values. It has no Atomic typed-property-resource
model. The shared variant splits issue users, labels, repository, milestone and
comment-author references into 13 shared keys while retaining all 132 records.
Other nested content stays intact. See the mapping and round-trip code in `model.js`.

The following are median initial receiver file bytes after scheduled persistence,
Replicache close and browser-process shutdown. Every file under the isolated
origin's IndexedDB directory is counted, including logs, history and metadata.
Displayed median byte values are rounded to the nearest byte.

| Model | Baseline apparent | Total apparent | Net apparent | Baseline allocated | Total allocated | Net allocated |
|---|---:|---:|---:|---:|---:|---:|
'''
for model,v in s['models'].items():
 a=v['stages']['initial']
 vals=[v['storage_baseline_apparent_bytes']['p50'],a['storage_total_apparent_bytes']['p50'],a['storage_net_apparent_bytes']['p50'],v['storage_baseline_allocated_bytes']['p50'],a['storage_total_allocated_bytes']['p50'],a['storage_net_allocated_bytes']['p50']]
 text+=f"| {names[model]} | "+' | '.join(n(x) for x in vals)+' |\n'
text+='''
Each raw row retains its baseline, actual total, net, and complete file list; medians
of these separate columns need not subtract exactly. Apparent bytes use `st_size`;
allocated bytes use `st_blocks × 512` on APFS. Browser quota estimates are retained
separately and can be padded. Global browser quota metadata cannot be assigned
precisely to a single database and is excluded; whole browser profiles, executables
and npm dependencies are excluded. No explicit compaction was performed.
The empty baseline precedes a second client open; growth includes that client metadata.
Incremental totals also retain history and verification-reopen metadata.

Required local service data is separate from the receiver:

| Model | Service apparent bytes | Service allocated bytes |
|---|---:|---:|
'''
for model,v in s['models'].items():
 a=v['service_disk'];text+=f"| {names[model]} | {n(a['apparent_bytes'])} | {n(a['allocated_bytes'])} |\n"
text+='''
Service totals include the three authoritative view versions and prepared response
cache used by this server. They are implementation costs, not an optimized backend
claim. No vendor service, personal identity, private credential or production data
was used.

'''
text+=f"Environment: {env['engine_version']}, source commit `{env['engine_source_commit']}`; Node {env['node']}, Playwright {env['playwright']}, {env['browser_version']}. Native macOS {env['macos'].strip().replace(chr(10),'; ')}, Darwin {env['kernel']}, {env['architecture']}, {env['cpu']}, {env['logical_cpus']} logical CPUs, {env['ram_bytes']//2**30} GiB RAM, APFS. No container or cgroup quotas.\n\n"
start=min(x['utc'] for x in raw['server_log'] if 'utc' in x)
end=max(x['utc'] for x in raw['server_log'] if 'utc' in x)
loads=[r['loadavg'][0] for r in raw['results']]
text+=f"Measured batches including warmups ran from {start} to {end} UTC. Receiver/service stores are under `/private/tmp/sync-benchmark-replicache-20261026-01a176de`, outside Documents; actual paths, filesystem, ports and environment are recorded per batch. The earlier smoke used the task's Documents work directory. One-minute host load ranged {min(loads):.1f}–{max(loads):.1f}. The recorded APFS volume capacity was 99% used during the first two batches. The shared atomic directory lock serialized this worker's sustained setup and batches with participating workers, and Atomic Model H received priority. The lock cannot eliminate other laptop activity or filesystem pressure. Cross-engine rankings remain provisional.\n\n"
text+='''Artifacts: `measured-results.json` contains all warmup/measured samples, cookie logs,
file inventories and full-content verification hashes; `measured-summary.json`
contains per-stage p50, p95 and maximum. Separate per-model environment/result files
are retained. `README.md`, `package-lock.json` and the adapter sources provide
reproduction commands and exact boundaries. Smoke runs are excluded from summaries.
The measurements were collected without upstream changes. See PUBLICATION.md for this publication copy.
'''
(p/'REPORT.md').write_text(text)
