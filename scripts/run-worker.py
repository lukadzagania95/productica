"""Run the local recognition service with project-owned secrets."""
import os,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
for line in (root/'.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1);os.environ.setdefault(k,v)
os.environ.setdefault('PRODUCTICA_MODELS_DIR',str(root/'worker/models'))
os.environ.setdefault('TORCH_HOME',str(root/'worker/models/.torch'))
os.chdir(root/'worker')
os.execv(sys.executable,[sys.executable,'-m','uvicorn','app:app','--host','127.0.0.1','--port','8001'])
