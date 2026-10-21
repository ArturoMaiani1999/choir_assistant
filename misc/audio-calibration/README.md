# Bach per il controllo iniziale degli altoparlanti

`bach-bwv846-strings.mscz` è la partitura modificabile in MuseScore 4;
`bach-bwv846-strings.musicxml` è il sorgente dell'adattamento. Le prime due
battute del Preludio in Do maggiore BWV 846 di Johann Sebastian Bach sono
arrangiate per archi (Violini, Viole e Violoncello), in 4/4 a 120 BPM.

Fonte delle note: [Mutopia, BWV 846](https://www.mutopiaproject.org/ftp/BachJS/BWV846/wtk1-prelude1/).
Il sorgente LilyPond e lo spartito della fonte dichiarano Public Domain.
L'adattamento aggiunge un leggero sostegno di violoncello all'ottava bassa.

Rendering locale, senza scaricare registrazioni di terzi:

```powershell
python scripts/build_calibration_music.py
```

Serve MuseScore 4 con il SoundFont MS Basic installato, NumPy e SciPy.
La ricetta esporta WAV da MuseScore, converte in mono PCM16 a 48 kHz,
ritaglia ciascuna battuta a 2 secondi, applica dissolvenze di 35 ms e porta
l'RMS a `0.08 / sqrt(3)`, equivalente al precedente rumore uniforme al
100% del volume dell'app. Non applica compressione o clipping. Non si
ridistribuisce il SoundFont: i WAV, il manifest e la licenza MIT originale
sono in `frontend/audio-calibration/`. Gli hash del manifest identificano
gli export effettivamente conservati, non promettono identità binaria tra
render successivi del sintetizzatore.

I passaggi iniziano a 2 s e 5 s nel controllo acustico di 8 s. Il browser
applica il volume corrente dell'app a un GainNode separato; il riferimento
al volume fisico del dispositivo al 50% resta un consiglio non misurato.

Lo script salva WAV grezzi con code e anteprima della partitura in
`artifacts/musical-calibration/render/`. Solo gli asset derivati entrano
nella build web; MusicXML e MSCZ restano fuori dal deploy.
