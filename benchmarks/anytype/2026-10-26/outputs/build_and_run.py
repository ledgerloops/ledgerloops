#!/usr/bin/env python3
"""Sequential native rebuild, all-model smoke, then the complete measured suite."""
import argparse, datetime, json, os, pathlib, shutil, subprocess, uuid
from build_runtime import build

OUT=pathlib.Path(__file__).resolve().parent
ROOT=OUT.parent
WORK=ROOT/'work'
LOCK=pathlib.Path(os.environ.get('SYNCBENCH_LOCK',str(pathlib.Path.home() / 'Documents/Codex/2026-10-24/th/work/sync-engine-comparison/measurement.lock')))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--smoke-only',action='store_true')
    args=parser.parse_args()
    owner=json.loads((LOCK/'owner.json').read_text())
    assert owner.get('engine')=='anytype' and owner.get('pid')==os.getppid(),'Run this through outputs/with_lock.py'
    assert not (LOCK.parent/'atomic-model-h-priority.json').exists(),'Atomic has priority'
    if not args.smoke_only and (OUT/'results.jsonl').exists():
        raise SystemExit('Refusing to overwrite existing results')
    build_path,env=build()
    runtime=pathlib.Path('/private/tmp')/('sync-benchmark-anytype-20261026-01a176de-'+uuid.uuid4().hex[:8])
    runtime.mkdir(mode=0o700)
    binary=[str(build_path/'syncbench'),'--fixture',str(build_path/'fixture.json')]
    smoke=runtime/'smoke.jsonl'
    subprocess.run(binary+['--warmups','0','--runs','1','--stores',str(runtime/'smoke'),'--out',str(smoke)],cwd=ROOT,env=env,check=True,timeout=180)
    rows=[json.loads(x) for x in smoke.read_text().splitlines()]
    assert len(rows)==3
    shutil.copyfile(smoke,OUT/'smoke-results.jsonl')
    if args.smoke_only:
        print('All three native models passed smoke, updates and reopening:',runtime,flush=True)
        return
    environment=json.loads((OUT/'environment.json').read_text())
    environment.update(storage_path=str(runtime/'measured'),raw_runtime_path=str(runtime/'results.jsonl'),utc_measurement_start=datetime.datetime.now(datetime.timezone.utc).isoformat(),runtime_filesystem=subprocess.check_output(['df','-h',str(runtime)],text=True))
    (OUT/'environment.json').write_text(json.dumps(environment,indent=2)+'\n')
    raw=runtime/'results.jsonl'
    subprocess.run(binary+['--warmups','3','--runs','10','--stores',str(runtime/'measured'),'--out',str(raw)],cwd=ROOT,env=env,check=True,timeout=900)
    shutil.copyfile(raw,OUT/'results.jsonl')
    environment['utc_measurement_end']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    (OUT/'environment.json').write_text(json.dumps(environment,indent=2)+'\n')
    subprocess.run(['python3',str(OUT/'verify_results.py')],cwd=ROOT,env=env,check=True)
    with (WORK/'summary-command.log').open('w') as log:
        subprocess.run(['python3',str(OUT/'summarize.py'),str(OUT/'results.jsonl')],cwd=ROOT,env=env,check=True,stdout=log)
    print('Complete: raw results, independent verification and summary in',OUT,flush=True)

if __name__=='__main__':main()
