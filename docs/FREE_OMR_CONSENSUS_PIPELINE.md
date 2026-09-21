# Free OMR consensus pipeline

This pipeline treats the PDF as evidence and never assumes an original Sibelius or other notation file exists.

```powershell
# One score (recommended for the first benchmark)
python scripts/run_omr_consensus.py "automate_mscz/animachristi.pdf"

# Every PDF
python scripts/run_omr_consensus.py
```

Stages:

1. classify the PDF as vector, scan, or mixed;
2. render lossless grayscale pages at 400 DPI (vector) or 600 DPI (scan);
3. run Audiveris and preserve its `.omr`, logs, and `candidate-a.musicxml`;
4. run `homr` page recognition and use its skew-aware neural staff coordinates;
5. crop those detected staves and run `oemer` independently on each one through isolated `uvx` environments;
6. assemble homr page results into `candidate-b.musicxml` only when the part count stays stable; retain each oemer crop as independent review evidence;
7. compare normalized pitch and duration sequences measure by measure;
8. ask Codex only to prioritize discrepancies for review—it may not edit or choose notes;
9. keep discrepancies in `reports/discordance.json` and non-rendered traceability metadata;
10. import the clean MusicXML into MuseScore and export `.mscz` plus PDF preview.

Outputs are stored under `data/omr-consensus/<piece>/`. `review/review.mscz` always remains `pending_human_review`. If only one engine succeeds, every measure is listed in the external report. If a page or system/staff grouping is missing or inconsistent, candidate B is rejected rather than silently assembled into a partial score.

Requirements already present on the target machine: Python, NumPy, Poppler (`pdfinfo`, `pdffonts`, `pdfimages`, `pdftoppm`), Audiveris, MuseScore 4, Codex, and `uvx`. The first neural run downloads the free `homr`/`oemer` environments and model files; subsequent runs reuse the uv cache.
