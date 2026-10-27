#!/usr/bin/env python3
"""Fetch and build pinned dependencies in an isolated /private/tmp directory."""
import json,os,pathlib,platform
from build_runtime import build

def main():
    lock=pathlib.Path(os.environ.get('SYNCBENCH_LOCK',str(pathlib.Path.home() / 'Documents/Codex/2026-10-24/th/work/sync-engine-comparison/measurement.lock')))
    owner=json.loads((lock/'owner.json').read_text())
    assert owner.get('engine')=='anytype' and owner.get('pid')==os.getppid(),'Run through outputs/with_lock.py'
    assert not (lock.parent/'atomic-model-h-priority.json').exists(),'Atomic has priority'
    assert (platform.system(),platform.machine())==('Darwin','arm64'),'Pinned toolchain is macOS arm64'
    path,_=build()
    print('Built pinned native harness:',path/'syncbench')

if __name__=='__main__':main()
