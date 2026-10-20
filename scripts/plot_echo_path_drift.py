"""Render a standalone acoustic-ablation figure. Singing energy is not F0 accuracy."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    args = parser.parse_args()
    folder = args.folder
    report = json.loads((folder/'path-drift-ablation.json').read_text(encoding='utf-8'))
    sr = report['sampleRate']
    fig, axes = plt.subplots(2, 1, figsize=(11, 7), layout='constrained')
    colors = ['#305b94', '#d18417', '#167963']
    for item, color in zip(report['bandDelays'], colors):
        axes[0].plot([4, 9], [item['initialMs'], item['laterMs']], 'o-', color=color,
                     label=f"{item['bandHz'][0]}–{item['bandHz'][1]} Hz")
    axes[0].set(xlim=(1, 16), ylim=(149, 158), ylabel='Ritardo del picco (ms)',
                title='Introduzione senza canto: variazione coerente di +3 ms in tre bande')
    axes[0].legend(loc='lower right', ncols=3)
    for filename, label, color in [('microphone-raw.f32', 'Microfono grezzo', '#305b94'),
        (report['channels']['frozen'], 'Sottrazione con ritardo iniziale', '#bc5050'),
        (report['channels']['trackedDelay'], 'Ritardo aggiornato da 10 s', '#167963')]:
        audio = np.fromfile(folder/filename, dtype='<f4')[:16*sr]
        block = sr//4
        values = audio[:len(audio)//block*block].reshape(-1, block).astype(float)
        levels = 20*np.log10(np.maximum(1e-9, np.sqrt(np.mean(values**2, axis=1))))
        axes[1].plot((np.arange(len(levels))+.5)*.25, levels, label=label, color=color, linewidth=1.5)
    axes[1].set(xlim=(1, 16), ylim=(-52, -16), ylabel='Livello RMS (dBFS)', xlabel='Tempo della registrazione (s)',
                title='Verifica separata a 10–16 s: meno rientro, senza voce nel campione')
    axes[1].legend(loc='lower right')
    for axis in axes:
        for a, b, label, color in [(2, 6, 'Stima filtro', '#b1c5df'), (8, 10, 'Stima ritardo', '#e4cf9d'),
                                   (10, 16, 'Verifica separata', '#b4d9cb')]:
            axis.axvspan(a, b, color=color, alpha=.16)
            axis.text((a+b)/2, .98, label, transform=axis.get_xaxis_transform(), ha='center', va='top', fontsize=9)
        axis.grid(alpha=.16)
        axis.spines[['top', 'right']].set_visible(False)
    fig.suptitle('Santo · test reale del 20 ottobre 2026 · analisi offline', fontsize=15)
    fig.savefig(folder/'path-drift-study.png', dpi=180)
    fig.savefig(folder/'path-drift-study.pdf')
    print(folder/'path-drift-study.png')


if __name__ == '__main__':
    main()
