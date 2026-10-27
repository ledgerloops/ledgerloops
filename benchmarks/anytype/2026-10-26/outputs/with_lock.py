#!/usr/bin/env python3
"""Serialize heavy work on the shared host; never remove a foreign lock."""
import argparse, datetime, json, os, pathlib, signal, subprocess, time, uuid

LOCK = pathlib.Path(os.environ.get('SYNCBENCH_LOCK', str(pathlib.Path.home() / 'Documents/Codex/2026-10-24/th/work/sync-engine-comparison/measurement.lock')))

def record(event):
    event['utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (pathlib.Path(__file__).resolve().parent/'coordination.jsonl').open('a') as f:
        f.write(json.dumps(event)+'\n')

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--timeout', type=float, default=900)
    p.add_argument('command', nargs=argparse.REMAINDER)
    a = p.parse_args()
    command = a.command[1:] if a.command[:1] == ['--'] else a.command
    if not command:
        p.error('command required')
    token = str(uuid.uuid4())
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    owner = dict(token=token, pid=os.getpid(), engine='anytype', cwd=os.getcwd(),
                 utc=datetime.datetime.now(datetime.timezone.utc).isoformat(), command=command)
    while True:
        # Atomic's first hybrid measurements get the next slot when signaled.
        waiting = [x for x in LOCK.parent.glob('*atomic*waiting*') if x.is_file()]
        priority = LOCK.parent / 'atomic-model-h-priority.json'
        if priority.exists():
            waiting.append(priority)
        try:
            if waiting:
                raise FileExistsError('Atomic worker waiting')
            LOCK.mkdir()
            (LOCK / 'owner.json').write_text(json.dumps(owner, indent=2))
            break
        except FileExistsError:
            if time.monotonic() - start >= a.timeout:
                evidence = {}
                for f in LOCK.glob('*.json'):
                    try:
                        other = json.loads(f.read_text())
                        pid = other.get('pid')
                        alive = None
                        if isinstance(pid, int):
                            try: os.kill(pid, 0); alive = True
                            except ProcessLookupError: alive = False
                            except PermissionError: alive = True
                        evidence[f.name] = dict(owner=other, pid_alive=alive)
                    except (ValueError, OSError): pass
                event=dict(status='lock_timeout', evidence=evidence, pid=os.getpid())
                record(event)
                print(json.dumps(event), flush=True)
                return 75
            time.sleep(0.25)
    print(json.dumps(dict(status='lock_acquired', owner=owner, waited_s=time.monotonic()-start)), flush=True)
    record(dict(status='lock_acquired', owner=owner, waited_s=time.monotonic()-start))
    child = None
    def stop(signum, frame):
        if child and child.poll() is None: child.terminate()
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        child = subprocess.Popen(command)
        return child.wait()
    finally:
        if child and child.poll() is None:
            child.terminate()
            try: child.wait(timeout=15)
            except subprocess.TimeoutExpired: child.kill(); child.wait()
        try:
            if json.loads((LOCK/'owner.json').read_text()).get('token') == token:
                (LOCK/'owner.json').unlink()
                LOCK.rmdir()
                record(dict(status='lock_released', token=token, pid=os.getpid(), child_exit_code=child.returncode if child else None))
        except (OSError, ValueError): pass

if __name__ == '__main__':
    raise SystemExit(main())
