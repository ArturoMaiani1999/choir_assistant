"""Reproducible Bach BWV 846 bars 1-2, arranged/exported with MuseScore Basic.

Only generated PCM and attribution enter the web build. Editable scores stay
under misc/audio-calibration; the installed SoundFont is never redistributed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import wave
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parents[1]
SCORES = ROOT / 'misc/audio-calibration'
ASSETS = ROOT / 'frontend/audio-calibration'
SOURCE = 'https://www.mutopiaproject.org/ftp/BachJS/BWV846/wtk1-prelude1/wtk1-prelude1.ly'
RATE = 48000
SECONDS = 2
TARGET_RMS = .08 / np.sqrt(3)  # Old uniform-noise probe at app volume 100%.


def sub(parent, tag, text=None, **attributes):
    node = ET.SubElement(parent, tag, attributes)
    if text is not None:node.text = str(text)
    return node


def note(parent, midi, duration, kind, voice=1, dots=0):
    n = sub(parent, 'note')
    if midi is None:sub(n, 'rest')
    else:
        p = sub(n, 'pitch')
        step, alter = [('C',0),('C',1),('D',0),('D',1),('E',0),('F',0),('F',1),('G',0),('G',1),('A',0),('A',1),('B',0)][midi % 12]
        sub(p, 'step', step)
        if alter:sub(p, 'alter', alter)
        sub(p, 'octave', midi // 12 - 1)
    sub(n, 'duration', duration);sub(n, 'voice', voice);sub(n, 'type', kind)
    for _ in range(dots):sub(n, 'dot')


def score(bars):
    root = ET.Element('score-partwise', version='4.0')
    sub(sub(root,'work'),'work-title','Bach · BWV 846 · Preparazione audio')
    identification = sub(root,'identification');sub(identification,'creator','Johann Sebastian Bach',type='composer')
    sub(identification,'rights','Composition and Mutopia engraving: Public Domain. Xynon string adaptation, bars 1-2.')
    listing = sub(root,'part-list')
    # MS Basic GM programs are one-based in MusicXML. Use the same strings
    # family as the app's accompaniment rather than third-party recordings.
    for part_id,name,program,channel in [('P1','Violini',49,1),('P2','Viole',42,2),('P3','Violoncello',43,3)]:
        definition = sub(listing,'score-part',id=part_id);sub(definition,'part-name',name)
        instrument = sub(definition,'score-instrument',id=part_id+'I');sub(instrument,'instrument-name',name)
        midi=sub(definition,'midi-instrument',id=part_id+'I');sub(midi,'midi-channel',channel);sub(midi,'midi-program',program)
        sub(midi,'volume',64 if part_id=='P1' else 48 if part_id=='P2' else 32)
        part=sub(root,'part',id=part_id)
        for number,bar in enumerate(bars,1):
            measure=sub(part,'measure',number=str(number))
            if number==1:
                attributes=sub(measure,'attributes');sub(attributes,'divisions',4)
                sub(sub(attributes,'key'),'fifths',0)
                meter=sub(attributes,'time');sub(meter,'beats',4);sub(meter,'beat-type',4)
                clef=sub(attributes,'clef');sub(clef,'sign','G' if part_id=='P1' else 'F' if part_id=='P3' else 'C');sub(clef,'line',2 if part_id=='P1' else 4 if part_id=='P3' else 3)
                direction=sub(measure,'direction');mark=sub(sub(direction,'direction-type'),'metronome');sub(mark,'beat-unit','quarter');sub(mark,'per-minute',120)
                sub(direction,'sound',tempo='120')
            if part_id=='P1':
                pitches = [67,72,76,67,72,76] if bar==1 else [69,74,77,69,74,77]
                for _ in range(2):
                    note(measure,None,2,'eighth')
                    for pitch in pitches:note(measure,pitch,1,'16th')
            elif part_id=='P2':
                for _ in range(2):note(measure,60,8,'half')
                sub(sub(measure,'backup'),'duration',16)
                for _ in range(2):
                    note(measure,None,1,'16th',voice=2)
                    note(measure,64 if bar==1 else 62,7,'quarter',voice=2,dots=2)
            else:note(measure,48,16,'whole')  # Explicit octave reinforcement.
    ET.indent(root)
    return ET.tostring(root,encoding='utf-8',xml_declaration=True)


def pcm(path):
    rate,original=wavfile.read(path)
    samples=original.astype(np.float64)
    if np.issubdtype(original.dtype,np.integer):samples/=max(abs(np.iinfo(original.dtype).min),np.iinfo(original.dtype).max)
    if samples.ndim>1:samples=samples.mean(axis=1)
    assert np.isfinite(samples).all(), 'Nonfinite MuseScore PCM'
    if rate!=RATE:
        from math import gcd
        common=gcd(rate,RATE);samples=resample_poly(samples,RATE//common,rate//common)
    return samples


def run_musescore(exe,source,destination,log):
    env=os.environ.copy();env.pop('QT_QPA_PLATFORM',None)
    result=subprocess.run([str(exe),'-f','--sound-profile','MuseScore Basic','-o',str(destination),str(source)],
        env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=120)
    log.write_text(result.stdout+result.stderr,encoding='utf-8')
    exists=destination.is_file() or destination.suffix=='.svg' and any(destination.parent.glob(destination.stem+'-*.svg'))
    if result.returncode or not exists:raise RuntimeError(f'MuseScore export failed ({result.returncode}): '+str(log))


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--musescore',type=Path,default=Path(r'C:\Program Files\MuseScore 4\bin\MuseScore4.exe'))
    args=parser.parse_args();SCORES.mkdir(parents=True,exist_ok=True);ASSETS.mkdir(parents=True,exist_ok=True)
    output=ROOT/'artifacts/musical-calibration/render';output.mkdir(parents=True,exist_ok=True)
    full=SCORES/'bach-bwv846-strings.musicxml';full.write_bytes(score([1,2]))
    run_musescore(args.musescore,full,SCORES/'bach-bwv846-strings.mscz',output/'score-export.log')
    run_musescore(args.musescore,SCORES/'bach-bwv846-strings.mscz',output/'score.svg',output/'engraving.log')
    reports=[]
    for bar in [1,2]:
        xml=output/f'bar-{bar}.musicxml';xml.write_bytes(score([bar]))
        wav=output/f'bar-{bar}-raw.wav';run_musescore(args.musescore,xml,wav,output/f'bar-{bar}.log')
        raw=pcm(wav)
        # Retain the start and deliberately fade the last release into the
        # existing one-second capture tail. Never cut a non-zero sample hard.
        samples=np.pad(raw,(0,max(0,RATE*SECONDS-len(raw))))[:RATE*SECONDS].copy()
        fade=round(.035*RATE);samples[:fade]*=np.linspace(0,1,fade);samples[-fade:]*=np.linspace(1,0,fade)
        gain=TARGET_RMS/np.sqrt(np.mean(samples*samples));samples*=gain
        if np.max(np.abs(samples))>.45:raise ValueError('Excessive crest factor; change arrangement, do not clip')
        destination=ASSETS/f'bach-bwv846-{bar}.wav'
        encoded=np.rint(samples*32767).astype('<i2')
        with wave.open(str(destination),'wb') as w:
            w.setnchannels(1);w.setsampwidth(2);w.setframerate(RATE);w.writeframes(encoded.tobytes())
        reports.append({'file':destination.name,'bar':bar,'seconds':SECONDS,'sampleRate':RATE,
            'rms':float(np.sqrt(np.mean(samples*samples))),'peak':float(np.max(np.abs(samples))),
            'renderSeconds':len(raw)/RATE,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()})
    licence=Path(r'C:\Program Files\MuseScore 4\sound\MS Basic_License.md')
    shutil.copyfile(licence,ASSETS/'MS-Basic-License.txt')
    manifest={'id':'bach-bwv846-strings-v1','composer':'Johann Sebastian Bach','work':'Prelude in C major, BWV 846',
        'bars':[1,2],'tempoQuarterBpm':120,'compositionRights':'Public Domain','engravingSource':SOURCE,
        'arrangement':'Xynon: first two bars, strings with light octave reinforcement; split into two probes.',
        'renderer':'MuseScore 4 / MuseScore Basic','soundFont':'MS Basic','soundFontLicense':'MS-Basic-License.txt',
        'targetRms':TARGET_RMS,'probes':reports}
    (ASSETS/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps(manifest,ensure_ascii=True))


if __name__=='__main__':main()
