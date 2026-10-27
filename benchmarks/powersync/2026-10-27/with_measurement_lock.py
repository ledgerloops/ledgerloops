#!/usr/bin/env python3
"""Atomic mkdir lock. Bounded waits; never removes another owner's lock."""
import os,sys,time,json,pathlib,uuid,subprocess,datetime,signal
LOCK=pathlib.Path(os.environ.get('BENCH_LOCK_PATH',str(pathlib.Path.home()/'Documents/Codex/2026-10-24/th/work/sync-engine-comparison/measurement.lock')))
LOCK.parent.mkdir(parents=True,exist_ok=True)
LOG=pathlib.Path(__file__).parent/'contention.jsonl'
token=str(uuid.uuid4()); start=time.monotonic(); atomic_seen=False; idle_since=None; last_log=0; last_owner=None
waiting=LOCK.parent/'powersync-waiting.json'
waiting.write_text(json.dumps({'engine':'powersync','pid':os.getpid(),'command':sys.argv[1:],'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}))
child=None

def stop(signum,frame):
    if child and child.poll() is None: child.send_signal(signum)
    raise SystemExit(128+signum)
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
try:
 while True:
    if time.monotonic()-start>1800:raise SystemExit('Bounded lock wait exceeded 30 min; other owners preserved')
    priority=LOCK.parent/'atomic-model-h-priority.json'
    if priority.exists():
        print('Atomic Model H priority marker present; deferring heavy work',flush=True)
        time.sleep(30);continue
    # Give Atomic the next slot when it has just been running or is waiting.
    atomic_waiters=list(LOCK.parent.glob('*atomic*waiting*'))
    if not LOCK.exists() and (atomic_seen or atomic_waiters):
        if idle_since is None: idle_since=time.monotonic()
        if atomic_waiters or time.monotonic()-idle_since<30:
            time.sleep(5); continue
    try:
        LOCK.mkdir()
        if priority.exists():
            LOCK.rmdir();time.sleep(5);continue
        break
    except FileExistsError:
        idle_since=None
        try: owner={p.name:p.read_text()[:4096] for p in LOCK.iterdir() if p.is_file()}
        except FileNotFoundError:continue
        atomic_seen=atomic_seen or 'atomic' in json.dumps(owner).lower()
        event={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'wait_seconds':time.monotonic()-start,'owner':owner}
        if owner!=last_owner or time.monotonic()-last_log>=15:
            with LOG.open('a') as f:f.write(json.dumps(event)+'\n')
            print(json.dumps(event),flush=True)
            last_log=time.monotonic();last_owner=owner
        if time.monotonic()-start>1800:raise SystemExit('Lock wait exceeded 30 min; existing owner preserved')
        time.sleep(0.5)
 owner={'engine':'powersync','task':str(pathlib.Path.cwd()),'pid':os.getpid(),'token':token,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':sys.argv[1:]}
 (LOCK/'owner.json').write_text(json.dumps(owner,indent=2))
 print('ACQUIRED '+json.dumps(owner),flush=True)
 try:
    child=subprocess.Popen(sys.argv[1:]); code=child.wait()
 finally:
    if child and child.poll() is None:
        child.terminate()
        try:child.wait(timeout=20)
        except subprocess.TimeoutExpired:child.kill();child.wait()
    if json.loads((LOCK/'owner.json').read_text()).get('token')==token:
        (LOCK/'owner.json').unlink(); LOCK.rmdir()
 raise SystemExit(code)
finally:
 try:
    if json.loads(waiting.read_text()).get('pid')==os.getpid():waiting.unlink()
 except FileNotFoundError:pass
