import { validRepertoireContext } from "./performances";
import type { Env, MemberContext } from "./types";

export const MAX_RECORDING_BYTES = 32 * 1024 * 1024;
export const MAX_PITCH_BYTES = 2 * 1024 * 1024;
export const MAX_RECORDING_DURATION_MS = 30 * 60 * 1000;
export const MAX_PITCH_SAMPLES = 12_000;

function supportedAudioType(contentType: string): boolean {
  return /^audio\/(webm|ogg)(;codecs=opus)?$/i.test(contentType) ||
    /^audio\/mp4(?:;codecs=[A-Za-z0-9._-]+)?$/i.test(contentType);
}

interface RecordingRow {
  id: string;
  choir_id: string;
  member_id: string;
  piece_id: string;
  score_version_id: string;
  part_id: string;
  audio_key: string;
  audio_etag: string;
  audio_size: number;
  audio_type: string;
  pitch_key: string;
  pitch_etag: string;
  pitch_size: number;
  duration_ms: number;
  audio_offset_ms: number;
  playback_rate: number;
  transpose: number;
  consented_at: string;
  shared_for_analysis: number;
  analysis_consented_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PitchReplayDocument {
  version: 1;
  totalBeats: number;
  durationMs: number;
  audioOffsetMs: number;
  playbackRate: number;
  transpose: number;
  samples: Array<{
    beat: number;
    displayPitch: number;
    confidence?: number;
    confirmationState?: "confirmed" | "provisional" | null;
  }>;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function validId(value: FormDataEntryValue | null): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

function summary(row: RecordingRow): Record<string, unknown> {
  return {
    id: row.id,
    pieceId: row.piece_id,
    scoreVersionId: row.score_version_id,
    partId: row.part_id,
    audioType: row.audio_type,
    audioSize: row.audio_size,
    durationMs: row.duration_ms,
    audioOffsetMs: row.audio_offset_ms,
    playbackRate: row.playback_rate,
    transpose: row.transpose,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sharedForAnalysis: row.shared_for_analysis === 1,
    analysisConsentedAt: row.analysis_consented_at,
    audioUrl: `/api/recordings/${encodeURIComponent(row.id)}/audio`,
    pitchUrl: `/api/recordings/${encodeURIComponent(row.id)}/pitch`,
  };
}

function requireDirector(member: MemberContext): Response | null {
  return member.roles.includes("director") ? null : json({ error: "forbidden" }, 403);
}

async function automaticBestStatus(env: Env, member: MemberContext): Promise<Response> {
  const row = await env.AUTH_DB.prepare(
    `SELECT automatic_best_recording, consented_at, updated_at
     FROM member_recording_preferences
     WHERE member_id=?1 AND choir_id=?2 LIMIT 1`,
  ).bind(member.memberId, member.choirId).first<{
    automatic_best_recording: number;
    consented_at: string | null;
    updated_at: string;
  }>();
  return json({
    enabled: row?.automatic_best_recording === 1,
    consentedAt: row?.consented_at ?? null,
    updatedAt: row?.updated_at ?? null,
  });
}

async function updateAutomaticBest(
  request: Request,
  env: Env,
  member: MemberContext,
): Promise<Response> {
  let payload: { enabled?: unknown };
  try { payload = await request.json() as { enabled?: unknown }; }
  catch { return json({ error: "invalid_consent" }, 400); }
  if (typeof payload.enabled !== "boolean") return json({ error: "invalid_consent" }, 400);
  const now = new Date().toISOString();
  await env.AUTH_DB.prepare(
    `INSERT INTO member_recording_preferences(
       member_id, choir_id, automatic_best_recording, consented_at, updated_at)
     VALUES(?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(member_id) DO UPDATE SET
       choir_id=excluded.choir_id,
       automatic_best_recording=excluded.automatic_best_recording,
       consented_at=excluded.consented_at,
       updated_at=excluded.updated_at`,
  ).bind(member.memberId, member.choirId, payload.enabled ? 1 : 0,
    payload.enabled ? now : null, now).run();
  return json({ enabled: payload.enabled, consentedAt: payload.enabled ? now : null, updatedAt: now });
}

async function directorRecordingById(env: Env, member: MemberContext, id: string): Promise<RecordingRow | null> {
  return env.AUTH_DB.prepare(
    `SELECT r.* FROM personal_recordings r
     JOIN authorized_members m ON m.member_id=r.member_id
     WHERE r.id=?1 AND r.choir_id=?2 AND r.shared_for_analysis=1 AND m.active=1 LIMIT 1`,
  ).bind(id, member.choirId).first<RecordingRow>();
}

async function listDirectorRecordings(request: Request, env: Env, member: MemberContext): Promise<Response> {
  const denied = requireDirector(member);
  if (denied) return denied;
  const pieceId = new URL(request.url).searchParams.get("pieceId");
  if (!validId(pieceId)) return json({ error: "invalid_recording" }, 400);
  const result = await env.AUTH_DB.prepare(
    `SELECT r.*,m.display_name,m.voice_part FROM personal_recordings r
     JOIN authorized_members m ON m.member_id=r.member_id
     WHERE r.choir_id=?1 AND r.piece_id=?2 AND r.shared_for_analysis=1 AND m.active=1
     ORDER BY m.display_name,r.updated_at DESC`,
  ).bind(member.choirId, pieceId).all<RecordingRow & { display_name: string; voice_part: string | null }>();
  return json({ recordings: (result.results ?? []).map(row => ({
    ...summary(row), memberId: row.member_id, displayName: row.display_name, voicePart: row.voice_part,
    audioUrl: `/api/cockpit/recordings/${encodeURIComponent(row.id)}/audio`,
    pitchUrl: `/api/cockpit/recordings/${encodeURIComponent(row.id)}/pitch`,
  })) });
}

export function inspectAudioHeader(bytes: ArrayBuffer, contentType: string): boolean {
  if (!supportedAudioType(contentType)) return false;
  const value = new Uint8Array(bytes);
  if (contentType.startsWith("audio/webm")) {
    return value.length >= 4 && value[0] === 0x1a && value[1] === 0x45 && value[2] === 0xdf && value[3] === 0xa3;
  }
  if (contentType.startsWith("audio/ogg")) {
    return value.length >= 4 && String.fromCharCode(...value.slice(0, 4)) === "OggS";
  }
  return value.length >= 12 && String.fromCharCode(...value.slice(4, 8)) === "ftyp";
}

export function parsePitchReplayDocument(value: unknown): PitchReplayDocument | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PitchReplayDocument>;
  if (candidate.version !== 1 || !Number.isFinite(candidate.totalBeats) ||
      candidate.totalBeats! <= 0 || candidate.totalBeats! > 10_000 ||
      !Number.isFinite(candidate.durationMs) || candidate.durationMs! <= 0 ||
      candidate.durationMs! > MAX_RECORDING_DURATION_MS ||
      !Number.isFinite(candidate.audioOffsetMs) || candidate.audioOffsetMs! < 0 ||
      candidate.audioOffsetMs! > 30_000 || !Number.isFinite(candidate.playbackRate) ||
      candidate.playbackRate! < 0.5 || candidate.playbackRate! > 1.5 ||
      !Number.isInteger(candidate.transpose) || candidate.transpose! < -12 ||
      candidate.transpose! > 12 || !Array.isArray(candidate.samples) ||
      candidate.samples.length === 0 || candidate.samples.length > MAX_PITCH_SAMPLES) return null;
  const valid = candidate.samples.every((sample) => {
    if (!sample || !Number.isFinite(sample.beat) || sample.beat < 0 ||
        sample.beat > candidate.totalBeats! + 1 || !Number.isFinite(sample.displayPitch) ||
        sample.displayPitch < 20 || sample.displayPitch > 127) return false;
    if (sample.confidence != null && (!Number.isFinite(sample.confidence) || sample.confidence < 0 || sample.confidence > 1)) return false;
    return sample.confirmationState == null || sample.confirmationState === "confirmed" ||
      sample.confirmationState === "provisional";
  });
  return valid ? candidate as PitchReplayDocument : null;
}

async function recordingById(env: Env, member: MemberContext, id: string): Promise<RecordingRow | null> {
  return env.AUTH_DB.prepare(
    `SELECT * FROM personal_recordings
     WHERE id = ?1 AND member_id = ?2 AND choir_id = ?3 LIMIT 1`,
  ).bind(id, member.memberId, member.choirId).first<RecordingRow>();
}

async function recordingForPiece(env: Env, member: MemberContext, pieceId: string): Promise<RecordingRow | null> {
  return env.AUTH_DB.prepare(
    `SELECT * FROM personal_recordings
     WHERE member_id = ?1 AND choir_id = ?2 AND piece_id = ?3 LIMIT 1`,
  ).bind(member.memberId, member.choirId, pieceId).first<RecordingRow>();
}

async function updateSharing(request: Request, env: Env, member: MemberContext, id: string): Promise<Response> {
  let payload: { sharedForAnalysis?: unknown };
  try { payload = await request.json() as { sharedForAnalysis?: unknown }; }
  catch { return json({ error: "invalid_recording" }, 400); }
  if (typeof payload.sharedForAnalysis !== "boolean") return json({ error: "invalid_recording" }, 400);
  const now = new Date().toISOString();
  const row = await env.AUTH_DB.prepare(
    `UPDATE personal_recordings
     SET shared_for_analysis=?1, analysis_consented_at=?2, updated_at=?3
     WHERE id=?4 AND member_id=?5 AND choir_id=?6
     RETURNING *`,
  ).bind(payload.sharedForAnalysis ? 1 : 0, payload.sharedForAnalysis ? now : null,
    now, id, member.memberId, member.choirId).first<RecordingRow>();
  return row ? json({ recording: summary(row) }) : json({ error: "recording_not_found" }, 404);
}

async function listMine(request: Request, env: Env, member: MemberContext): Promise<Response> {
  const pieceId = new URL(request.url).searchParams.get("pieceId");
  if (pieceId != null && !validId(pieceId)) return json({ error: "invalid_recording" }, 400);
  const statement = pieceId
    ? env.AUTH_DB.prepare(
      `SELECT * FROM personal_recordings
       WHERE member_id = ?1 AND choir_id = ?2 AND piece_id = ?3 ORDER BY updated_at DESC`,
    ).bind(member.memberId, member.choirId, pieceId)
    : env.AUTH_DB.prepare(
      `SELECT * FROM personal_recordings
       WHERE member_id = ?1 AND choir_id = ?2 ORDER BY updated_at DESC`,
    ).bind(member.memberId, member.choirId);
  const result = await statement.all<RecordingRow>();
  return json({ recordings: (result.results ?? []).map(summary) });
}

async function readObject(
  request: Request,
  env: Env,
  member: MemberContext,
  id: string,
  kind: "audio" | "pitch",
): Promise<Response> {
  if (!env.PERFORMANCE_BUCKET) throw new Error("recording bucket unavailable");
  const row = await recordingById(env, member, id);
  if (!row) return json({ error: "recording_not_found" }, 404);
  const key = kind === "audio" ? row.audio_key : row.pitch_key;
  const rangeRequested = kind === "audio" && request.headers.has("Range");
  const object = await env.PERFORMANCE_BUCKET.get(key, rangeRequested ? { range: request.headers } : undefined);
  if (!object) throw new Error("referenced recording object missing");
  const headers = new Headers({
    "Content-Type": kind === "audio" ? row.audio_type : "application/json; charset=utf-8",
    "Content-Length": String(object.size),
    ETag: object.httpEtag,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (kind === "audio") headers.set("Accept-Ranges", "bytes");
  if (rangeRequested && object.range && "offset" in object.range &&
      "length" in object.range && Number.isFinite(object.range.length)) {
    const start = object.range.offset ?? 0;
    const length = object.range.length as number;
    headers.set("Content-Length", String(length));
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${row.audio_size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { headers });
}

async function readDirectorObject(
  request: Request,
  env: Env,
  member: MemberContext,
  id: string,
  kind: "audio" | "pitch",
): Promise<Response> {
  const denied = requireDirector(member);
  if (denied) return denied;
  if (!env.PERFORMANCE_BUCKET) throw new Error("recording bucket unavailable");
  const row = await directorRecordingById(env, member, id);
  if (!row) return json({ error: "recording_not_found" }, 404);
  const key = kind === "audio" ? row.audio_key : row.pitch_key;
  const rangeRequested = kind === "audio" && request.headers.has("Range");
  const object = await env.PERFORMANCE_BUCKET.get(key, rangeRequested ? { range: request.headers } : undefined);
  if (!object) throw new Error("referenced recording object missing");
  const headers = new Headers({
    "Content-Type": kind === "audio" ? row.audio_type : "application/json; charset=utf-8",
    "Content-Length": String(object.size), ETag: object.httpEtag,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  });
  if (kind === "audio") headers.set("Accept-Ranges", "bytes");
  if (rangeRequested && object.range && "offset" in object.range && "length" in object.range && Number.isFinite(object.range.length)) {
    const start = object.range.offset ?? 0; const length = object.range.length as number;
    headers.set("Content-Length", String(length));
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${row.audio_size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { headers });
}

async function submitRecording(request: Request, env: Env, member: MemberContext): Promise<Response> {
  if (!env.PERFORMANCE_BUCKET) throw new Error("recording bucket unavailable");
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RECORDING_BYTES + MAX_PITCH_BYTES + 128 * 1024) {
    return json({ error: "recording_too_large" }, 413);
  }
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: "invalid_recording" }, 400); }
  const pieceId = form.get("pieceId");
  const scoreVersionId = form.get("scoreVersionId");
  const partId = form.get("partId");
  const replaceExisting = form.get("replaceExisting") === "true";
  const consent = form.get("consent") === "true";
  const headphonesConfirmed = form.get("headphonesConfirmed") === "true";
  const sharedForAnalysis = form.get("sharedForAnalysis") === "true";
  const durationMs = Number(form.get("durationMs"));
  const audioOffsetMs = Number(form.get("audioOffsetMs"));
  const playbackRate = Number(form.get("playbackRate"));
  const transpose = Number(form.get("transpose"));
  const audio = form.get("audio");
  const pitch = form.get("pitch");
  if (!validId(pieceId) || !validId(scoreVersionId) || !validId(partId) || !consent ||
      !headphonesConfirmed || !Number.isFinite(durationMs) || durationMs <= 0 ||
      durationMs > MAX_RECORDING_DURATION_MS || !Number.isFinite(audioOffsetMs) ||
      audioOffsetMs < 0 || audioOffsetMs > 30_000 || !Number.isFinite(playbackRate) ||
      playbackRate < 0.5 || playbackRate > 1.5 || !Number.isInteger(transpose) ||
      transpose < -12 || transpose > 12 || !(audio instanceof File) ||
      !supportedAudioType(audio.type) || audio.size <= 0 || audio.size > MAX_RECORDING_BYTES ||
      !(pitch instanceof File) || pitch.type !== "application/json" ||
      pitch.size <= 0 || pitch.size > MAX_PITCH_BYTES) {
    return json({ error: "invalid_recording" }, 400);
  }
  if (!(await validRepertoireContext(env, pieceId, scoreVersionId, partId))) {
    return json({ error: "invalid_recording" }, 400);
  }
  if (!inspectAudioHeader(await audio.slice(0, 16).arrayBuffer(), audio.type)) {
    return json({ error: "invalid_recording" }, 400);
  }
  let pitchDocument: PitchReplayDocument | null = null;
  try { pitchDocument = parsePitchReplayDocument(JSON.parse(await pitch.text())); } catch { /* invalid below */ }
  if (!pitchDocument || Math.abs(pitchDocument.durationMs - durationMs) > 1000 ||
      Math.abs(pitchDocument.audioOffsetMs - audioOffsetMs) > 50 ||
      Math.abs(pitchDocument.playbackRate - playbackRate) > 0.001 ||
      pitchDocument.transpose !== transpose) {
    return json({ error: "invalid_recording" }, 400);
  }

  const existing = await recordingForPiece(env, member, pieceId);
  if (existing && !replaceExisting) {
    return json({ error: "recording_exists", recording: summary(existing) }, 409);
  }

  const revision = crypto.randomUUID();
  const prefix = `recordings/${member.choirId}/${member.memberId}/${pieceId}/${revision}`;
  const audioKey = `${prefix}.${audio.type.startsWith("audio/mp4") ? "m4a" : audio.type.startsWith("audio/ogg") ? "ogg" : "webm"}`;
  const pitchKey = `${prefix}.pitch.json`;
  const normalizedPitch = JSON.stringify(pitchDocument);
  const [storedAudio, storedPitch] = await Promise.all([
    env.PERFORMANCE_BUCKET.put(audioKey, audio.stream(), {
      httpMetadata: { contentType: audio.type, cacheControl: "private, no-store" },
      customMetadata: { memberId: member.memberId, pieceId, kind: "personal-recording" },
    }),
    env.PERFORMANCE_BUCKET.put(pitchKey, normalizedPitch, {
      httpMetadata: { contentType: "application/json", cacheControl: "private, no-store" },
      customMetadata: { memberId: member.memberId, pieceId, kind: "pitch-replay" },
    }),
  ]).catch(async (error) => {
    await env.PERFORMANCE_BUCKET!.delete([audioKey, pitchKey]).catch(() => undefined);
    throw error;
  });
  const now = new Date().toISOString();
  try {
    const accepted = await env.AUTH_DB.prepare(
      `INSERT INTO personal_recordings(
         id, choir_id, member_id, piece_id, score_version_id, part_id,
         audio_key, audio_etag, audio_size, audio_type,
         pitch_key, pitch_etag, pitch_size, duration_ms, audio_offset_ms,
         playback_rate, transpose, consented_at, headphones_confirmed, shared_for_analysis,
         analysis_consented_at, created_at, updated_at)
       VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, 1, ?19, ?20, ?18, ?18)
       ON CONFLICT(member_id, piece_id) DO UPDATE SET
         score_version_id=excluded.score_version_id, part_id=excluded.part_id,
         audio_key=excluded.audio_key, audio_etag=excluded.audio_etag,
         audio_size=excluded.audio_size, audio_type=excluded.audio_type,
         pitch_key=excluded.pitch_key, pitch_etag=excluded.pitch_etag,
         pitch_size=excluded.pitch_size, duration_ms=excluded.duration_ms,
         audio_offset_ms=excluded.audio_offset_ms, playback_rate=excluded.playback_rate,
         transpose=excluded.transpose, consented_at=excluded.consented_at,
         headphones_confirmed=1, shared_for_analysis=excluded.shared_for_analysis,
         analysis_consented_at=excluded.analysis_consented_at, updated_at=excluded.updated_at
       WHERE ?21 = 1
       RETURNING id`,
    ).bind(
      crypto.randomUUID(), member.choirId, member.memberId, pieceId, scoreVersionId,
      partId, audioKey, storedAudio.etag, audio.size, audio.type, pitchKey,
      storedPitch.etag, new TextEncoder().encode(normalizedPitch).byteLength,
      Math.round(durationMs), Math.round(audioOffsetMs), playbackRate, transpose,
      now, sharedForAnalysis ? 1 : 0, sharedForAnalysis ? now : null, replaceExisting ? 1 : 0,
    ).first<{ id: string }>();
    if (!accepted) {
      await env.PERFORMANCE_BUCKET.delete([audioKey, pitchKey]);
      const current = await recordingForPiece(env, member, pieceId);
      return json({ error: "recording_exists", recording: current ? summary(current) : null }, 409);
    }
    if (existing) {
      try {
        await env.PERFORMANCE_BUCKET.delete([existing.audio_key, existing.pitch_key]);
        await env.AUTH_DB.prepare(
          "DELETE FROM recording_object_cleanup WHERE object_key IN (?1, ?2)",
        ).bind(existing.audio_key, existing.pitch_key).run();
      } catch { /* D1 triggers keep both old keys queued. */ }
    }
    const current = await recordingById(env, member, accepted.id);
    return json({ updated: Boolean(existing), recording: current ? summary(current) : null });
  } catch (error) {
    await env.PERFORMANCE_BUCKET.delete([audioKey, pitchKey]).catch(() => undefined);
    throw error;
  }
}

async function deleteOwn(env: Env, member: MemberContext, id: string): Promise<Response> {
  if (!env.PERFORMANCE_BUCKET) throw new Error("recording bucket unavailable");
  const deleted = await env.AUTH_DB.prepare(
    `DELETE FROM personal_recordings
     WHERE id = ?1 AND member_id = ?2 AND choir_id = ?3
     RETURNING audio_key, pitch_key`,
  ).bind(id, member.memberId, member.choirId)
    .first<{ audio_key: string; pitch_key: string }>();
  if (!deleted) return json({ error: "recording_not_found" }, 404);
  try {
    await env.PERFORMANCE_BUCKET.delete([deleted.audio_key, deleted.pitch_key]);
    await env.AUTH_DB.prepare(
      "DELETE FROM recording_object_cleanup WHERE object_key IN (?1, ?2)",
    ).bind(deleted.audio_key, deleted.pitch_key).run();
  } catch { /* Deletion is authoritative in D1; scheduled cleanup retries R2. */ }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function handlePersonalRecordingApi(
  request: Request,
  env: Env,
  member: MemberContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/recordings/automatic-best") {
    if (request.method === "GET") return automaticBestStatus(env, member);
    if (request.method === "PATCH") return updateAutomaticBest(request, env, member);
  }
  if (request.method === "GET" && url.pathname === "/api/recordings/mine") return listMine(request, env, member);
  if (request.method === "POST" && url.pathname === "/api/recordings") return submitRecording(request, env, member);
  if (request.method === "GET" && url.pathname === "/api/cockpit/recordings") return listDirectorRecordings(request, env, member);
  const directorObjectMatch = /^\/api\/cockpit\/recordings\/([^/]+)\/(audio|pitch)$/.exec(url.pathname);
  if (request.method === "GET" && directorObjectMatch) {
    return readDirectorObject(request, env, member, decodeURIComponent(directorObjectMatch[1]), directorObjectMatch[2] as "audio" | "pitch");
  }
  const objectMatch = /^\/api\/recordings\/([^/]+)\/(audio|pitch)$/.exec(url.pathname);
  if (request.method === "GET" && objectMatch) {
    return readObject(request, env, member, decodeURIComponent(objectMatch[1]), objectMatch[2] as "audio" | "pitch");
  }
  const sharingMatch = /^\/api\/recordings\/([^/]+)\/sharing$/.exec(url.pathname);
  if (request.method === "PATCH" && sharingMatch) {
    return updateSharing(request, env, member, decodeURIComponent(sharingMatch[1]));
  }
  const deleteMatch = /^\/api\/recordings\/([^/]+)$/.exec(url.pathname);
  if (request.method === "DELETE" && deleteMatch) return deleteOwn(env, member, decodeURIComponent(deleteMatch[1]));
  return url.pathname.startsWith("/api/recordings") || url.pathname.startsWith("/api/cockpit/recordings")
    ? json({ error: "api_not_found" }, 404) : null;
}

export async function purgeExpiredPersonalRecordings(
  env: Env,
  inactiveRetentionDays = 30,
  activeRetentionDays = 365,
): Promise<number> {
  if (!env.PERFORMANCE_BUCKET) return 0;
  const inactiveCutoff = new Date(Date.now() - inactiveRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  const activeCutoff = new Date(Date.now() - activeRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  const expired = await env.AUTH_DB.prepare(
    `SELECT r.id, r.audio_key, r.pitch_key FROM personal_recordings r
     JOIN authorized_members m ON m.member_id = r.member_id
     WHERE (m.active = 0 AND m.revoked_at IS NOT NULL AND m.revoked_at <= ?1)
        OR r.updated_at <= ?2
     ORDER BY r.updated_at LIMIT 100`,
  ).bind(inactiveCutoff, activeCutoff).all<{ id: string; audio_key: string; pitch_key: string }>();
  let removed = 0;
  for (const item of expired.results ?? []) {
    try {
      const result = await env.AUTH_DB.prepare(
        "DELETE FROM personal_recordings WHERE id = ?1 AND audio_key = ?2 AND pitch_key = ?3",
      ).bind(item.id, item.audio_key, item.pitch_key).run();
      removed += result.meta.changes ?? 0;
      await env.PERFORMANCE_BUCKET.delete([item.audio_key, item.pitch_key]);
      await env.AUTH_DB.prepare(
        "DELETE FROM recording_object_cleanup WHERE object_key IN (?1, ?2)",
      ).bind(item.audio_key, item.pitch_key).run();
    } catch { /* D1 triggers retain object keys for the cleanup retry. */ }
  }
  const queued = await env.AUTH_DB.prepare(
    "SELECT object_key FROM recording_object_cleanup ORDER BY queued_at LIMIT 200",
  ).all<{ object_key: string }>();
  for (const item of queued.results ?? []) {
    try {
      await env.PERFORMANCE_BUCKET.delete(item.object_key);
      await env.AUTH_DB.prepare(
        "DELETE FROM recording_object_cleanup WHERE object_key = ?1",
      ).bind(item.object_key).run();
    } catch { /* Preserve the queue row for the next scheduled retry. */ }
  }
  return removed;
}
