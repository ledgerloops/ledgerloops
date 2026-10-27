#!/usr/bin/env python3
"""Build pinned public source outside Documents; caller must hold shared lock."""
import hashlib, json, os, pathlib, subprocess, tarfile, time, urllib.request
OUT=pathlib.Path(__file__).resolve().parent
BUILD=pathlib.Path('/private/tmp/sync-benchmark-anytype-20261026-01a176de-build')

def read_complete(path):
    for attempt in range(3):
        size=path.stat().st_size;data=path.read_bytes()
        if len(data)==size and size>0:return data
        time.sleep(.1)
    raise RuntimeError('Incomplete source read: '+str(path))

def build():
    pins=json.loads(read_complete(OUT/'pins.json'));BUILD.mkdir(mode=0o700,exist_ok=True)
    tool=pins['toolchain'];archive=BUILD/'go.tar.gz'
    if not archive.exists():urllib.request.urlretrieve(tool['url'],archive)
    assert hashlib.sha256(archive.read_bytes()).hexdigest()==tool['sha256']
    go=BUILD/'go/bin/go'
    if not go.exists():
        with tarfile.open(archive) as t:
            for m in t.getmembers():assert BUILD.resolve() in (BUILD/m.name).resolve().parents
            t.extractall(BUILD)
    source=BUILD/'any-sync'
    env=dict(os.environ,GIT_TERMINAL_PROMPT='0',GOTOOLCHAIN='local',GOPATH=str(BUILD/'gopath'),GOCACHE=str(BUILD/'gocache'),GOMAXPROCS='4',PYTHONDONTWRITEBYTECODE='1')
    git=['git','-c','credential.helper=','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false']
    def run(*args):return subprocess.run(args,env=env,check=True,timeout=600)
    if not source.exists():
        run(*git,'init',str(source));run(*git,'-C',str(source),'fetch','--depth','1',pins['any_sync']['url'],pins['any_sync']['commit']);run(*git,'-C',str(source),'checkout','--detach','FETCH_HEAD')
    rev=subprocess.check_output(git+['-C',str(source),'rev-parse','HEAD'],text=True,env=env,timeout=15).strip()
    assert rev==pins['any_sync']['commit']
    dirty=subprocess.check_output(git+['-C',str(source),'status','--porcelain'],text=True,env=env,timeout=15).strip()
    assert not dirty,'Pinned source changed'
    for item in json.loads(read_complete(OUT/'source-review.json'))['files']:assert hashlib.sha256((source/item['path']).read_bytes()).hexdigest()==item['sha256']
    harness=BUILD/'harness';harness.mkdir(exist_ok=True);provenance={}
    for name in ['main.go','go.mod','go.sum']:
        data=read_complete(OUT/'harness'/name)
        if name=='go.mod':data=data.replace(b'../../work/any-sync',b'../any-sync')
        (harness/name).write_bytes(data);provenance[name]=hashlib.sha256(data).hexdigest()
    fixture=read_complete(OUT/'fixture/fixture.json')
    assert hashlib.sha256(fixture).hexdigest()=='9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a'
    (BUILD/'fixture.json').write_bytes(fixture)
    run(str(go),'-C',str(harness),'mod','download');run(str(go),'-C',str(harness),'build','-mod=readonly','-p','4','-o',str(BUILD/'syncbench'),'.')
    provenance.update(build_path=str(BUILD),engine_commit=rev,toolchain_sha256=tool['sha256'],module_replace='../any-sync',fixture_sha256=hashlib.sha256(fixture).hexdigest())
    (OUT/'build-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    return BUILD,env
