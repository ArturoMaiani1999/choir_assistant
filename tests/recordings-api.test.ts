import { describe, expect, it } from "vitest";

import { handlePersonalRecordingApi } from "../src/recordings";
import type { Env, MemberContext } from "../src/types";

type Row = Record<string, string | number>;

function member(id = "member-one"): MemberContext {
  return { memberId: id, choirId: "choir-one", displayName: id, voicePart: "tenore", roles: ["singer"], groupIds: [], viewableGroupIds: [] };
}

function director(): MemberContext {
  return { ...member("director-one"), roles: ["singer", "director"] };
}

function fakeEnv() {
  const recordings: Row[] = [];
  const preferences = new Map<string, Row>();
  const objects = new Map<string, { bytes: Uint8Array; type?: string; etag: string }>();
  const database = {
    prepare(query: string) {
      let bound: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bound = values; return statement; },
        async first<T>() {
          if (query.includes("FROM member_recording_preferences")) {
            const found = preferences.get(String(bound[0]));
            return found?.choir_id === bound[1] ? { ...found } as T : null;
          }
          if (query.includes("UPDATE personal_recordings") && query.includes("shared_for_analysis=?1")) {
            const found = recordings.find(row => row.id === bound[3] && row.member_id === bound[4] && row.choir_id === bound[5]);
            if (!found) return null;
            found.shared_for_analysis = Number(bound[0]);
            found.analysis_consented_at = bound[1] == null ? "" : String(bound[1]);
            found.updated_at = String(bound[2]);
            return { ...found } as T;
          }
          if (query.includes("SELECT r.* FROM personal_recordings") && query.includes("shared_for_analysis=1")) {
            const found = recordings.find(row => row.id === bound[0] && row.choir_id === bound[1]
              && row.shared_for_analysis === 1);
            return found ? { ...found } as T : null;
          }
          if (query.includes("SELECT * FROM personal_recordings") && query.includes("WHERE id = ?1")) {
            const found = recordings.find(row => row.id === bound[0] && row.member_id === bound[1] && row.choir_id === bound[2]);
            return found ? { ...found } as T : null;
          }
          if (query.includes("SELECT * FROM personal_recordings") && query.includes("piece_id = ?3")) {
            const found = recordings.find(row => row.member_id === bound[0] && row.choir_id === bound[1] && row.piece_id === bound[2]);
            return found ? { ...found } as T : null;
          }
          if (query.includes("INSERT INTO personal_recordings")) {
            const current = recordings.find(row => row.member_id === bound[2] && row.piece_id === bound[3]);
            if (current && bound[20] !== 1) return null;
            const row: Row = {
              id: current?.id ?? String(bound[0]), choir_id: String(bound[1]), member_id: String(bound[2]),
              piece_id: String(bound[3]), score_version_id: String(bound[4]), part_id: String(bound[5]),
              audio_key: String(bound[6]), audio_etag: String(bound[7]), audio_size: Number(bound[8]), audio_type: String(bound[9]),
              pitch_key: String(bound[10]), pitch_etag: String(bound[11]), pitch_size: Number(bound[12]),
              duration_ms: Number(bound[13]), audio_offset_ms: Number(bound[14]), playback_rate: Number(bound[15]),
              transpose: Number(bound[16]), consented_at: String(bound[17]),
              shared_for_analysis: Number(bound[18]), analysis_consented_at: bound[19] == null ? "" : String(bound[19]),
              created_at: String(current?.created_at ?? bound[17]), updated_at: String(bound[17]),
            };
            if (current) Object.assign(current, row); else recordings.push(row);
            return { id: row.id } as T;
          }
          if (query.includes("DELETE FROM personal_recordings")) {
            const index = recordings.findIndex(row => row.id === bound[0] && row.member_id === bound[1] && row.choir_id === bound[2]);
            if (index < 0) return null;
            const [deleted] = recordings.splice(index, 1);
            return { audio_key: deleted.audio_key, pitch_key: deleted.pitch_key } as T;
          }
          return null;
        },
        async all<T>() {
          if (query.includes("SELECT r.*,m.display_name,m.voice_part")) {
            return { results: recordings.filter(row => row.choir_id === bound[0] && row.piece_id === bound[1]
              && row.shared_for_analysis === 1).map(row => ({ ...row, display_name: "Singer One", voice_part: "tenore" })) as T[] };
          }
          if (query.includes("SELECT * FROM personal_recordings")) {
            return { results: recordings.filter(row => row.member_id === bound[0] && row.choir_id === bound[1]
              && (bound[2] == null || row.piece_id === bound[2])) as T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          if (query.includes("INSERT INTO member_recording_preferences")) {
            preferences.set(String(bound[0]), {
              member_id: String(bound[0]), choir_id: String(bound[1]),
              automatic_best_recording: Number(bound[2]),
              consented_at: bound[3] == null ? "" : String(bound[3]), updated_at: String(bound[4]),
            });
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  const bucket = {
    async put(key: string, value: ReadableStream | string) {
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      const etag = `etag-${objects.size + 1}`;
      objects.set(key, { bytes, etag });
      return { key, etag };
    },
    async get(key: string) {
      const stored = objects.get(key);
      if (!stored) return null;
      return {
        body: new Blob([stored.bytes.slice().buffer as ArrayBuffer]).stream(), size: stored.bytes.byteLength,
        etag: stored.etag, httpEtag: `"${stored.etag}"`,
      };
    },
    async delete(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
  } as unknown as R2Bucket;
  const assets = { fetch: async () => Response.json({
    published: true, piece_id: "song-one", score_version_id: "score-v1", parts: [{ id: "tenor" }],
  }) } as unknown as Fetcher;
  return { env: { AUTH_DB: database, PERFORMANCE_BUCKET: bucket, ASSETS: assets } as Env, recordings, objects, preferences };
}

function audioFile() {
  return new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])], "voice.webm", { type: "audio/webm;codecs=opus" });
}

function form(replaceExisting = false, consent = true, headphones = true, sharedForAnalysis = false): FormData {
  const pitch = { version: 1, totalBeats: 48, durationMs: 5000, audioOffsetMs: 120,
    playbackRate: 1, transpose: 0, samples: [{ beat: 1, displayPitch: 60, confidence: .8 }] };
  const value = new FormData();
  Object.entries({ pieceId: "song-one", scoreVersionId: "score-v1", partId: "tenor",
    durationMs: 5000, audioOffsetMs: 120, playbackRate: 1, transpose: 0,
    replaceExisting, consent, headphonesConfirmed: headphones, sharedForAnalysis }).forEach(([key, item]) => value.set(key, String(item)));
  value.set("audio", audioFile());
  value.set("pitch", new File([JSON.stringify(pitch)], "pitch.json", { type: "application/json" }));
  return value;
}

function post(body: FormData) {
  return new Request("https://choir.example/api/recordings", { method: "POST", body });
}

describe("personal recording API", () => {
  it("persists one revocable authorization for automatic best recordings", async () => {
    const { env } = fakeEnv();
    const endpoint = "https://choir.example/api/recordings/automatic-best";
    const initial = await handlePersonalRecordingApi(new Request(endpoint), env, member());
    expect(await initial?.json()).toMatchObject({ enabled: false, consentedAt: null });

    const enable = await handlePersonalRecordingApi(new Request(endpoint, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }), env, member());
    expect(await enable?.json()).toMatchObject({ enabled: true });
    const enabled = await handlePersonalRecordingApi(new Request(endpoint), env, member());
    expect(await enabled?.json()).toMatchObject({ enabled: true });

    const disable = await handlePersonalRecordingApi(new Request(endpoint, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    }), env, member());
    expect(await disable?.json()).toMatchObject({ enabled: false, consentedAt: null });
  });

  it("creates one owner-only recording and requires explicit replacement", async () => {
    const { env, recordings, objects } = fakeEnv();
    const created = await handlePersonalRecordingApi(post(form()), env, member());
    expect(created?.status).toBe(200);
    expect(recordings).toHaveLength(1);
    expect(objects.size).toBe(2);

    const conflict = await handlePersonalRecordingApi(post(form()), env, member());
    expect(conflict?.status).toBe(409);
    expect(recordings).toHaveLength(1);
    expect(objects.size).toBe(2);

    const replaced = await handlePersonalRecordingApi(post(form(true)), env, member());
    expect(replaced?.status).toBe(200);
    expect(await replaced?.json()).toMatchObject({ updated: true });
    expect(recordings).toHaveLength(1);
    expect(objects.size).toBe(2);

    const recordingId = String(recordings[0].id);
    const denied = await handlePersonalRecordingApi(
      new Request(`https://choir.example/api/recordings/${recordingId}/pitch`), env, member("member-two"),
    );
    expect(denied?.status).toBe(404);
  });

  it("rejects upload without both storage consent and headphones confirmation", async () => {
    const { env } = fakeEnv();
    expect((await handlePersonalRecordingApi(post(form(false, false, true)), env, member()))?.status).toBe(400);
    expect((await handlePersonalRecordingApi(post(form(false, true, false)), env, member()))?.status).toBe(400);
  });

  it("exposes audio to a same-choir director only after explicit analysis opt-in", async () => {
    const { env, recordings } = fakeEnv();
    await handlePersonalRecordingApi(post(form()), env, member());
    const id = String(recordings[0].id);
    expect((await handlePersonalRecordingApi(
      new Request("https://choir.example/api/cockpit/recordings?pieceId=song-one"), env, director(),
    ))?.status).toBe(200);
    expect(await (await handlePersonalRecordingApi(
      new Request("https://choir.example/api/cockpit/recordings?pieceId=song-one"), env, director(),
    ))?.json()).toMatchObject({ recordings: [] });
    expect((await handlePersonalRecordingApi(
      new Request(`https://choir.example/api/cockpit/recordings/${id}/audio`), env, director(),
    ))?.status).toBe(404);

    await handlePersonalRecordingApi(post(form(true, true, true, true)), env, member());
    const listing = await handlePersonalRecordingApi(
      new Request("https://choir.example/api/cockpit/recordings?pieceId=song-one"), env, director(),
    );
    expect(await listing?.json()).toMatchObject({ recordings: [{ id, sharedForAnalysis: true }] });
    expect((await handlePersonalRecordingApi(
      new Request(`https://choir.example/api/cockpit/recordings/${id}/audio`), env, director(),
    ))?.status).toBe(200);
    expect((await handlePersonalRecordingApi(
      new Request(`https://choir.example/api/cockpit/recordings/${id}/audio`), env, member("member-two"),
    ))?.status).toBe(403);
  });

  it("lets only the owner toggle analysis sharing without uploading the audio again", async () => {
    const { env, recordings, objects } = fakeEnv();
    await handlePersonalRecordingApi(post(form()), env, member());
    const id = String(recordings[0].id); const objectCount = objects.size;
    const sharingRequest = (sharedForAnalysis: boolean, owner = member()) => handlePersonalRecordingApi(
      new Request(`https://choir.example/api/recordings/${id}/sharing`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sharedForAnalysis }),
      }), env, owner,
    );
    expect((await sharingRequest(true, member("member-two")))?.status).toBe(404);
    const shared = await sharingRequest(true);
    expect(await shared?.json()).toMatchObject({ recording: { id, sharedForAnalysis: true } });
    expect(objects.size).toBe(objectCount);
    expect(await (await handlePersonalRecordingApi(
      new Request("https://choir.example/api/cockpit/recordings?pieceId=song-one"), env, director(),
    ))?.json()).toMatchObject({ recordings: [{ id }] });
    const revoked = await sharingRequest(false);
    expect(await revoked?.json()).toMatchObject({ recording: { id, sharedForAnalysis: false } });
    expect(await (await handlePersonalRecordingApi(
      new Request("https://choir.example/api/cockpit/recordings?pieceId=song-one"), env, director(),
    ))?.json()).toMatchObject({ recordings: [] });
  });
});
