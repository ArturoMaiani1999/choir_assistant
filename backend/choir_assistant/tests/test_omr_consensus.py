import json
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np

from choir_assistant.ingestion.omr_consensus import (
    annotate_for_review,
    assemble_page_candidates,
    compare_candidates,
    crops_from_homr_positions,
    detect_staves,
    preprocess_pgm,
    write_pgm,
)


def score(path: Path, second_pitch: str = "D") -> None:
    path.write_text(f"""<?xml version="1.0"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure>
<measure number="2"><note><pitch><step>{second_pitch}</step><octave>4</octave></pitch><duration>4</duration></note></measure>
</part></score-partwise>""", encoding="utf-8")


class OmrConsensusTests(unittest.TestCase):
    def test_homr_positions_drive_staff_crops(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            page = root / "page.pgm"
            write_pgm(page, np.full((200, 400), 255, dtype=np.uint8))
            positions = root / "page.txt"
            positions.write_text("0 0.5 0.25 0.8 0.08\n1 0.5 0.70 0.8 0.15\n", encoding="utf-8")
            crops = crops_from_homr_positions(page, positions, root / "crops")
            self.assertEqual(len(crops), 2)
            self.assertTrue(crops[1]["grand_staff"])
            self.assertTrue(all(Path(item["path"]).is_file() for item in crops))

    def test_page_candidates_require_stable_part_count(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            first, second = root / "one.musicxml", root / "two.musicxml"
            score(first); score(second)
            result = assemble_page_candidates([first, second], root / "joined.musicxml")
            self.assertEqual(result["parts_per_page"], [1, 1])
            self.assertEqual(result["measures_per_part"], [4])

    def test_preprocessing_normalizes_contrast_without_changing_geometry(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            image = np.array([[80, 120], [160, 200]], dtype=np.uint8)
            source, target = root / "source.pgm", root / "target.pgm"
            write_pgm(source, image)
            preprocess_pgm(source, target)
            from choir_assistant.ingestion.omr_consensus import read_pgm
            result = read_pgm(target)
            self.assertEqual(result.shape, image.shape)
            self.assertLessEqual(int(result.min()), 5)
            self.assertGreaterEqual(int(result.max()), 250)

    def test_pitch_disagreement_is_annotated_not_repaired(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            left, right, review = root / "a.musicxml", root / "b.musicxml", root / "review.musicxml"
            score(left, "D"); score(right, "E")
            comparison = compare_candidates(left, right)
            self.assertEqual(comparison["discordance_count"], 1)
            self.assertEqual(comparison["discordances"][0]["measure"], 2)
            annotate_for_review(left, review, comparison)
            parsed = ET.parse(review).getroot()
            self.assertIsNone(parsed.find("./part/measure[2]/direction"))
            metadata = json.loads(parsed.findtext("./miscellaneous/miscellaneous-field[@name='choir-review-discordances']"))
            self.assertEqual(metadata["count"], 1)
            self.assertEqual(parsed.findtext("./part/measure[2]/note/pitch/step"), "D")

    def test_staff_detector_emits_lossless_crops(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            image = np.full((240, 400), 255, dtype=np.uint8)
            for start in (50, 140):
                for y in range(start, start + 25, 6):
                    image[y, 20:380] = 0
            page = root / "page.pgm"
            write_pgm(page, image)
            result = detect_staves(page, root / "crops")
            self.assertEqual(result["staff_count"], 2)
            self.assertEqual(result["staves_per_system"], [2])
            self.assertTrue(all(Path(crop["path"]).is_file() for crop in result["crops"]))


if __name__ == "__main__":
    unittest.main()
