#!/usr/bin/env python3
"""Bounded, ownership-checked shared measurement lock. Retry exit 75 later."""
import datetime, json, os, pathlib, random, subprocess, sys, time, uuid

shared = pathlib.Path.home() / 'Documents/Codex/2026-10-24/th/work/sync-engine-comparison'
shared = pathlib.Path(os.environ.get('MEASUREMENT_LOCK_PARENT', str(shared)))
shared.mkdir(parents=True, exist_ok=True)
lock = shared / 'measurement.lock'
token = str(uuid.uuid4())
owner = dict(token=token, pid=os.getpid(), engine='replicache', task=os.getcwd(),
             utc=datetime.datetime.now(datetime.timezone.utc).isoformat(), command=sys.argv[1:])
waiting = shared / 'replicache-waiting.json'
waiting.write_text(json.dumps(owner, indent=2))
deadline = time.monotonic() + float(os.environ.get('LOCK_WAIT_SECONDS', '50'))
acquired = False
def journal(event, **extra):
    with pathlib.Path(__file__).with_name('lock-events.jsonl').open('a') as stream:
        stream.write(json.dumps(dict(event=event, at=datetime.datetime.now(datetime.timezone.utc).isoformat(), owner=owner, **extra))+'\n')
try:
    while time.monotonic() < deadline:
        # The Atomic worker's first hybrid measurements have priority. Any
        # explicit Atomic wait marker yields this slot until it is removed.
        priority = any(p for p in shared.iterdir() if 'atomic' in p.name.lower() and ('waiting' in p.name.lower() or p.name in ['atomic.waiting','atomic-model-h-priority.json']))
        if not priority:
            try:
                lock.mkdir()
                (lock / 'owner.json').write_text(json.dumps(owner, indent=2))
                acquired = True
                journal('acquired')
                break
            except FileExistsError:
                pass
        time.sleep(.15 + random.random() * .2)
    if not acquired:
        print('Shared measurement lock unavailable; no heavy work started.', flush=True)
        journal('unavailable')
        if (lock / 'owner.json').exists():
            data = json.loads((lock / 'owner.json').read_text())
            print(json.dumps(data, indent=2), flush=True)
            try:
                os.kill(int(data['pid']), 0)
                print('Owner PID exists; lock left untouched.', flush=True)
            except ProcessLookupError:
                print('STALE EVIDENCE: owner PID absent; lock left untouched.', flush=True)
        sys.exit(75)
    waiting.unlink(missing_ok=True)
    print('Acquired measurement lock: ' + token, flush=True)
    sys.exit(subprocess.call(sys.argv[1:]))
finally:
    if waiting.exists():
        try:
            if json.loads(waiting.read_text()).get('token') == token:
                waiting.unlink()
        except (FileNotFoundError, json.JSONDecodeError):
            pass
    if acquired:
        try:
            if json.loads((lock / 'owner.json').read_text()).get('token') == token:
                (lock / 'owner.json').unlink()
                lock.rmdir()
                print('Released own measurement lock.', flush=True)
                journal('released')
        except FileNotFoundError:
            pass
