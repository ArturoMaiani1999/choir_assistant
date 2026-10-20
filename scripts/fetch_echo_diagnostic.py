"""Fetch one consented, unexpired staging echo test via the authorized Cloudflare operator."""
import argparse
import json
import subprocess
import sys
import uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
WRANGLER=ROOT/'node_modules/wrangler/bin/wrangler.js'

def run(*args):
    return subprocess.run(['node',str(WRANGLER),*args],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',check=True).stdout

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--id',required=True,type=uuid.UUID)
    args=parser.parse_args();identifier=str(args.id)
    query=("SELECT d.* FROM echo_diagnostics d JOIN authorized_members m ON m.member_id=d.member_id AND m.choir_id=d.choir_id "
           f"WHERE d.id='{identifier}' AND m.active=1 AND d.consented_at IS NOT NULL AND julianday(d.expires_at)>julianday('now')")
    result=json.loads(run('d1','execute','choir-assistant-auth-staging','--config','wrangler.jsonc','--remote','--command',query,'--json'))
    rows=result[0]['results']
    if len(rows)!=1:raise SystemExit('Test assente, eliminato, scaduto o senza consenso attivo')
    row=rows[0];prefix=f"echo-diagnostics/{row['choir_id']}/{row['member_id']}/{row['piece_id']}/"
    if not row['object_key'].startswith(prefix) or '..' in row['object_key']:raise SystemExit('Unexpected object scope')
    folder=ROOT/'artifacts/echo-diagnostics'/identifier;folder.mkdir(parents=True,exist_ok=True)
    target=folder/'diagnostic.wav'
    run('r2','object','get','choir-assistant-performances-staging/'+row['object_key'],'--remote','--file',str(target))
    (folder/'storage.json').write_text(json.dumps(row,indent=2)+'\n',encoding='utf-8')
    subprocess.run([sys.executable,str(ROOT/'scripts/read_echo_diagnostic.py'),str(target),'--output',str(folder)],check=True)
    print(f'Test diagnostico privato: {folder}')

if __name__=='__main__':main()
