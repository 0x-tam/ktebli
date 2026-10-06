#!/usr/bin/env python3
"""Build a public-only deployment directory; never deploy the repository root."""
import hashlib,json,shutil,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
FILES=('index.html','order.html','website.css','website.js','vercel.json')
def stage(destination):
    dest=Path(destination).resolve()
    if dest==ROOT or ROOT in dest.parents:raise ValueError('Stage outside the repository')
    if dest.exists() and any(dest.iterdir()):raise ValueError('Destination must be empty')
    dest.mkdir(parents=True,exist_ok=True)
    hashes={}
    for name in FILES:
        src=ROOT/name
        if src.is_symlink() or not src.is_file():raise ValueError('Public file must be a regular file: '+name)
        if name=='vercel.json':
            config=json.loads(src.read_text())
            if set(config)!={'framework','buildCommand','outputDirectory','rewrites'}:
                raise ValueError('Unexpected root deployment config keys')
            # The standalone manual stage has no build script. Its config only
            # carries the reviewed rewrites; Git-connected deploys use the
            # root build command to emit the four public assets.
            (dest/name).write_text(json.dumps({'rewrites':config['rewrites']},indent=2)+'\n')
        else:shutil.copyfile(src,dest/name)
        hashes[name]=hashlib.sha256((dest/name).read_bytes()).hexdigest()
    return hashes
if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('Usage: stage_site.py EMPTY_DIRECTORY_OUTSIDE_REPO')
    print(json.dumps(stage(sys.argv[1]),indent=2))
