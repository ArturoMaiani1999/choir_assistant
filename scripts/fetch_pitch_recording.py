"""Read a consented staging recording through the configured Cloudflare operator.

No cookies, auth bypass, public URLs or cloud writes. Private downloads and
metadata go to the gitignored artifacts directory. Requires wrangler login.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WRANGLER = ROOT / 'node_modules' / 'wrangler' / 'bin' / 'wrangler.js'


def wrangler(*args):
    return subprocess.run(['node', str(WRANGLER), *args], cwd=ROOT,
                          capture_output=True, text=True, check=True, encoding='utf-8').stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--id', required=True, type=uuid.UUID, help='Consented Pitch Lab recording UUID')
    args = parser.parse_args()
    identifier = str(args.id)
    query = ("SELECT r.id,r.audio_key,r.pitch_key,r.piece_id,r.part_id,r.duration_ms,"
             "r.analysis_consented_at,r.choir_id,m.voice_part FROM personal_recordings r "
             "JOIN authorized_members m ON m.member_id=r.member_id AND m.choir_id=r.choir_id "
             f"WHERE r.id='{identifier}' AND r.shared_for_analysis=1 AND m.active=1")
    response = json.loads(wrangler('d1', 'execute', 'choir-assistant-auth-staging', '--remote', '--command', query, '--json'))
    rows = response[0]['results']
    if len(rows) != 1 or not rows[0]['analysis_consented_at']:
        raise SystemExit('Recording unavailable or without technical-analysis consent')
    row = rows[0]
    folder = ROOT / 'artifacts' / 'pitch-research' / identifier
    folder.mkdir(parents=True, exist_ok=True)
    bucket = 'choir-assistant-performances-staging'
    for key, filename in [('audio_key', 'recording.webm'), ('pitch_key', 'recording.pitch.json')]:
        if not row[key].startswith(f"recordings/{row['choir_id']}/"):
            raise SystemExit('Unexpected object scope')
        wrangler('r2', 'object', 'get', f'{bucket}/{row[key]}', '--remote', '--file', str(folder / filename))
    (folder / 'recording.metadata.json').write_text(json.dumps(row, indent=2), encoding='utf-8')
    subprocess.run([sys.executable, str(ROOT / 'scripts' / 'decode_pitch_audio.py'),
                    str(folder / 'recording.webm'), str(folder / 'recording.f32')], check=True)
    metadata = json.loads((folder / 'recording.f32.json').read_text(encoding='utf-8'))
    manifest = {'recordings': [{'id': identifier, 'groupId': identifier, 'split': 'diagnostic',
                               'pcm': 'recording.f32', 'sampleRate': metadata['sampleRate']}]}
    (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f"Private local manifest: {folder / 'manifest.json'}")


if __name__ == '__main__':
    main()
