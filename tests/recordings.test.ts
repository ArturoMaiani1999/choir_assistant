import { describe, expect, it } from "vitest";

import {
  MAX_PITCH_SAMPLES,
  inspectAudioHeader,
  parsePitchReplayDocument,
} from "../src/recordings";

function bytes(values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function validPitchDocument() {
  return {
    version: 1,
    totalBeats: 48,
    durationMs: 82_000,
    audioOffsetMs: 180,
    playbackRate: 1,
    transpose: 0,
    samples: [
      { beat: 1, displayPitch: 60.1, confidence: 0.82, confirmationState: "confirmed" },
      { beat: 1.05, displayPitch: 60.2, confidence: 0.74, confirmationState: "provisional" },
    ],
  };
}

describe("personal recording audio validation", () => {
  it("accepts the supported container signatures", () => {
    expect(inspectAudioHeader(bytes([0x1a, 0x45, 0xdf, 0xa3]), "audio/webm;codecs=opus")).toBe(true);
    expect(inspectAudioHeader(bytes([0x4f, 0x67, 0x67, 0x53]), "audio/ogg")).toBe(true);
    expect(inspectAudioHeader(bytes([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]), "audio/mp4")).toBe(true);
  });

  it("rejects mismatched or arbitrary media", () => {
    expect(inspectAudioHeader(bytes([0x4f, 0x67, 0x67, 0x53]), "audio/webm")).toBe(false);
    expect(inspectAudioHeader(bytes([0x1a, 0x45, 0xdf, 0xa3]), "text/html")).toBe(false);
  });
});

describe("personal recording pitch replay validation", () => {
  it("accepts a bounded versioned trajectory", () => {
    expect(parsePitchReplayDocument(validPitchDocument())).toEqual(validPitchDocument());
  });

  it("rejects invalid samples and oversized trajectories", () => {
    expect(parsePitchReplayDocument({ ...validPitchDocument(), samples: [{ beat: 2, displayPitch: 250 }] })).toBeNull();
    expect(parsePitchReplayDocument({
      ...validPitchDocument(),
      samples: Array.from({ length: MAX_PITCH_SAMPLES + 1 }, () => ({ beat: 1, displayPitch: 60 })),
    })).toBeNull();
  });
});
