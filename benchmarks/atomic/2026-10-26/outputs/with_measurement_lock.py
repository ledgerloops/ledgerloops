#!/usr/bin/env python3
"""Run a command while owning the shared atomic-mkdir measurement lock."""
import datetime, json, os, pathlib, subprocess, sys, time, uuid
LOCK = (pathlib.Path.home()/'Documents/Codex/2026-10-24/th/work/sync-engine-comparison/measurement.lock')
LOG = pathlib.Path(__file__).parent / 'contention.jsonl'
token = str(uuid.uuid4())
start = time.monotonic()
while True:
    try:
        LOCK.mkdir()
        break
    except FileExistsError:
        owner = {p.name: p.read_text(errors='replace')[:4096] for p in LOCK.iterdir() if p.is_file()}
        event = {'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'wait_seconds':time.monotonic()-start, 'owner':owner}
        with LOG.open('a') as f: f.write(json.dumps(event)+'\n')
        print(json.dumps(event), flush=True)
        if time.monotonic()-start > 1800:
            sys.exit('Lock still held after 30 minutes; owner left intact. Inspect for staleness.')
        time.sleep(30)
owner = {'token':token, 'pid':os.getpid(), 'cwd':os.getcwd(), 'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'command':sys.argv[1:], 'engine':'atomic'}
(LOCK/'owner.json').write_text(json.dumps(owner, indent=2))
try:
    result = subprocess.run(sys.argv[1:])
finally:
    if json.loads((LOCK/'owner.json').read_text()).get('token') == token:
        (LOCK/'owner.json').unlink()
        LOCK.rmdir()
sys.exit(result.returncode)
