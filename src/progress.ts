import type { Env, MemberContext, VoicePart } from "./types";

export const MONITORING_TERMS_VERSION = "2026-10-16-v1";
export const ATTEMPT_RETENTION_DAYS = 365;
export const MIN_COMPLETION_COVERAGE = 60;
export const READY_COVERAGE = 75;
export const READY_SCORE = 80;
export const ACCEPTABLE_CENTS = 100;
export const MAX_SHARED_TRACE_BYTES = 512 * 1024;
export const MAX_SHARED_TRACE_SAMPLES = 2_400;

const VOICE_PARTS: VoicePart[] = ["soprano", "contralto", "tenore", "basso"];

interface SharedTraceSample {
  beat: number;
  displayPitch: number;
  targetPitch: number;
  errorCents: number;
  confidence?: number;
}

interface SegmentMetric {
  occurrence: number;
  measureNumber: string;
  startBeat: number;
  endBeat: number;
  sampleCount: number;
  outOfToleranceCount: number;
}

export interface SharedTraceDocument {
  version: 1;
  totalBeats: number;
  samples: SharedTraceSample[];
  segments: SegmentMetric[];
}

interface AttemptPayload {
  pieceId?: unknown;
  scoreVersionId?: unknown;
  partId?: unknown;
  startedFromBeginning?: unknown;
  reachedEnd?: unknown;
  completed?: unknown;
  score?: unknown;
  coverage?: unknown;
  voicedMs?: unknown;
  playbackRate?: unknown;
  transpose?: unknown;
  trace?: unknown;
}

interface AttemptRow {
  id: string;
  member_id: string;
  display_name: string;
  voice_part: VoicePart;
  part_id: string;
  trace_key: string;
  created_at: string;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

async function rows<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

function normalizedVoiceLabel(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

export function canonicalVoicePart(name: string, id = ""): VoicePart | null {
  const value = normalizedVoiceLabel(`${name} ${id}`);
  if (/sopran/.test(value)) return "soprano";
  if (/contralt|\balto\b/.test(value)) return "contralto";
  if (/tenor/.test(value)) return "tenore";
  if (/bass/.test(value)) return "basso";
  return null;
}

export function parseSharedTrace(value: unknown): SharedTraceDocument | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SharedTraceDocument>;
  if (candidate.version !== 1 || !Number.isFinite(candidate.totalBeats) ||
      candidate.totalBeats! <= 0 || candidate.totalBeats! > 10_000 ||
      !Array.isArray(candidate.samples) || candidate.samples.length === 0 ||
      candidate.samples.length > MAX_SHARED_TRACE_SAMPLES || !Array.isArray(candidate.segments) ||
      candidate.segments.length > 2_000) return null;
  const samplesValid = candidate.samples.every((sample) => sample &&
    Number.isFinite(sample.beat) && sample.beat >= 0 && sample.beat <= candidate.totalBeats! + 1 &&
    Number.isFinite(sample.displayPitch) && sample.displayPitch >= 20 && sample.displayPitch <= 127 &&
    Number.isFinite(sample.targetPitch) && sample.targetPitch >= 20 && sample.targetPitch <= 127 &&
    Number.isFinite(sample.errorCents) && Math.abs(sample.errorCents) <= 4_800 &&
    (sample.confidence == null || (Number.isFinite(sample.confidence) && sample.confidence >= 0 && sample.confidence <= 1)));
  const segmentsValid = candidate.segments.every((segment) => segment &&
    Number.isInteger(segment.occurrence) && segment.occurrence >= 0 &&
    typeof segment.measureNumber === "string" && segment.measureNumber.length <= 24 &&
    Number.isFinite(segment.startBeat) && Number.isFinite(segment.endBeat) &&
    segment.startBeat >= 0 && segment.endBeat > segment.startBeat &&
    Number.isInteger(segment.sampleCount) && segment.sampleCount >= 0 &&
    Number.isInteger(segment.outOfToleranceCount) && segment.outOfToleranceCount >= 0 &&
    segment.outOfToleranceCount <= segment.sampleCount);
  return samplesValid && segmentsValid ? candidate as SharedTraceDocument : null;
}

async function repertoirePart(
  env: Env,
  pieceId: string,
  scoreVersionId?: string,
  partId?: string,
): Promise<{ id: string; name: string; scoreVersionId: string; voicePart: VoicePart | null } | null> {
  const url = new URL(`/library-assets/${encodeURIComponent(pieceId)}/bundle.json`, "https://assets.invalid");
  const response = await env.ASSETS.fetch(new Request(url));
  if (!response.ok) return null;
  const bundle = await response.json<{
    piece_id?: string;
    score_version_id?: string;
    published?: boolean;
    parts?: Array<{ id?: string; name?: string }>;
  }>();
  if (bundle.published !== true || bundle.piece_id !== pieceId ||
      (scoreVersionId != null && bundle.score_version_id !== scoreVersionId)) return null;
  if (partId == null) return { id: "", name: "", scoreVersionId: bundle.score_version_id ?? "", voicePart: null };
  const part = (bundle.parts ?? []).find(item => item.id === partId);
  if (!part?.id || !part.name) return null;
  return { id: part.id, name: part.name, scoreVersionId: bundle.score_version_id ?? "", voicePart: canonicalVoicePart(part.name, part.id) };
}

async function isAssigned(env: Env, choirId: string, pieceId: string): Promise<boolean> {
  const row = await env.AUTH_DB.prepare(
    "SELECT 1 AS assigned FROM repertoire_assignments WHERE choir_id=?1 AND piece_id=?2 AND active=1 LIMIT 1",
  ).bind(choirId, pieceId).first<{ assigned: number }>();
  return row?.assigned === 1;
}

async function hasAcceptedTerms(env: Env, memberId: string): Promise<boolean> {
  const row = await env.AUTH_DB.prepare(
    "SELECT 1 AS accepted FROM member_terms_acceptance WHERE member_id = ?1 AND terms_version = ?2 LIMIT 1",
  ).bind(memberId, MONITORING_TERMS_VERSION).first<{ accepted: number }>();
  return row?.accepted === 1;
}

async function consentStatus(env: Env, member: MemberContext): Promise<Response> {
  return json({
    version: MONITORING_TERMS_VERSION,
    accepted: await hasAcceptedTerms(env, member.memberId),
    notice: {
      individualVisibility: "I direttori vedono nome, avanzamento, punteggio e piano roll condiviso.",
      audioPrivacy: "L'audio personale resta privato e non viene usato dal cockpit.",
      aggregation: "Le metriche derivate contribuiscono agli aggregati della sezione.",
    },
  });
}

async function acceptTerms(request: Request, env: Env, member: MemberContext): Promise<Response> {
  let body: { version?: unknown; accepted?: unknown };
  try { body = await request.json(); } catch { return json({ error: "invalid_consent" }, 400); }
  if (body.version !== MONITORING_TERMS_VERSION || body.accepted !== true) {
    return json({ error: "invalid_consent" }, 400);
  }
  const now = new Date().toISOString();
  await env.AUTH_DB.prepare(
    `INSERT INTO member_terms_acceptance(member_id, terms_version, accepted_at)
     VALUES(?1, ?2, ?3)
     ON CONFLICT(member_id, terms_version) DO UPDATE SET accepted_at=excluded.accepted_at`,
  ).bind(member.memberId, MONITORING_TERMS_VERSION, now).run();
  return json({ version: MONITORING_TERMS_VERSION, accepted: true, acceptedAt: now });
}

async function readAssignments(env: Env, member: MemberContext) {
  const assignments = await rows<{
    piece_id: string;
    assigned_at: string;
    updated_at: string;
    status: "in_progress" | "completed" | "ready" | null;
    first_practiced_at: string | null;
    last_practiced_at: string | null;
    last_completed_at: string | null;
    completion_count: number | null;
    latest_score: number | null;
    latest_coverage: number | null;
    best_score: number | null;
    best_coverage: number | null;
    max_completed_speed: number | null;
  }>(env.AUTH_DB.prepare(
    `SELECT a.piece_id, a.assigned_at, a.updated_at,
            p.status, p.first_practiced_at, p.last_practiced_at, p.last_completed_at,
            p.completion_count, p.latest_score, p.latest_coverage,
            p.best_score, p.best_coverage, p.max_completed_speed
       FROM repertoire_assignments a
       LEFT JOIN member_piece_progress p
         ON p.choir_id = a.choir_id AND p.piece_id = a.piece_id AND p.member_id = ?2
       WHERE a.choir_id = ?1 AND a.active = 1
       ORDER BY a.assigned_at, a.piece_id`,
  ).bind(member.choirId, member.memberId));
  return assignments.map(item => ({
    pieceId: item.piece_id,
    assignedAt: item.assigned_at,
    updatedAt: item.updated_at,
    status: item.status ?? "not_started",
    firstPracticedAt: item.first_practiced_at,
    lastPracticedAt: item.last_practiced_at,
    lastCompletedAt: item.last_completed_at,
    completionCount: item.completion_count ?? 0,
    latestScore: item.latest_score,
    latestCoverage: item.latest_coverage,
    bestScore: item.best_score,
    bestCoverage: item.best_coverage,
    maxCompletedSpeed: item.max_completed_speed,
  }));
}

async function listAssignments(env: Env, member: MemberContext): Promise<Response> {
  return json({ assignments: await readAssignments(env, member) });
}

async function repertoireOverview(env: Env, member: MemberContext): Promise<Response> {
  // Resolve authentication/member context once for the whole read-only page.
  const [assignments, catalogResponse] = await Promise.all([
    readAssignments(env, member),
    env.ASSETS.fetch(new Request(new URL("/library.json", env.APP_ORIGIN))),
  ]);
  if (!catalogResponse.ok) throw new Error("Repertoire catalog unavailable");
  const catalog = await catalogResponse.json<{ pieces: Array<{
    piece_id: string;
    title: string;
    parts: Array<{ id: string; name: string }>;
  }> }>();
  const assignedIds = new Set(assignments.map(item => item.pieceId));
  return json({
    voicePart: member.preferredVoicePart ?? member.voicePart,
    canDirect: member.roles.includes("director"),
    assignments,
    pieces: catalog.pieces.filter(piece => assignedIds.has(piece.piece_id)).map(piece => ({
      piece_id: piece.piece_id, title: piece.title, parts: piece.parts,
    })),
  });
}

function attemptStatus(completed: boolean, score: number, coverage: number): "in_progress" | "completed" | "ready" {
  if (!completed) return "in_progress";
  return score >= READY_SCORE && coverage >= READY_COVERAGE ? "ready" : "completed";
}

async function submitAttempt(request: Request, env: Env, member: MemberContext): Promise<Response> {
  if (!member.voicePart) return json({ error: "voice_part_required" }, 409);
  if (!(await hasAcceptedTerms(env, member.memberId))) return json({ error: "consent_required" }, 428);
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SHARED_TRACE_BYTES) {
    return json({ error: "attempt_too_large" }, 413);
  }
  let body: AttemptPayload;
  try { body = await request.json(); } catch { return json({ error: "invalid_attempt" }, 400); }
  if (!validId(body.pieceId) || !validId(body.scoreVersionId) || !validId(body.partId)) {
    return json({ error: "invalid_attempt" }, 400);
  }
  const score = Number(body.score), coverage = Number(body.coverage), voicedMs = Number(body.voicedMs);
  const playbackRate = Number(body.playbackRate), transpose = Number(body.transpose);
  if (!Number.isInteger(score) || score < 0 || score > 100 || !Number.isFinite(coverage) ||
      coverage < 0 || coverage > 100 || !Number.isFinite(voicedMs) || voicedMs < 0 ||
      !Number.isFinite(playbackRate) || playbackRate < 0.5 || playbackRate > 1.5 ||
      !Number.isInteger(transpose) || transpose < -12 || transpose > 12) {
    return json({ error: "invalid_attempt" }, 400);
  }
  if (voicedMs < 10_000 && coverage < 10) return json({ ignored: true, reason: "insufficient_activity" });
  if (!(await isAssigned(env, member.choirId, body.pieceId))) {
    return json({ ignored: true, reason: "piece_not_assigned" });
  }
  const part = await repertoirePart(env, body.pieceId, body.scoreVersionId, body.partId);
  if (!part || part.voicePart !== member.voicePart) return json({ error: "assigned_voice_part_required" }, 409);
  const startedFromBeginning = body.startedFromBeginning === true;
  const reachedEnd = body.reachedEnd === true;
  const requestedCompleted = body.completed === true;
  const completed = requestedCompleted && startedFromBeginning && reachedEnd && coverage >= MIN_COMPLETION_COVERAGE;
  const trace = parseSharedTrace(body.trace);
  if (completed && !trace) return json({ error: "invalid_attempt_trace" }, 400);

  const id = crypto.randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ATTEMPT_RETENTION_DAYS * 86_400_000).toISOString();
  let traceKey: string | null = null;
  let traceEtag: string | null = null;
  let traceSize: number | null = null;
  if (completed) {
    if (!env.PERFORMANCE_BUCKET) throw new Error("performance bucket unavailable");
    const normalized = JSON.stringify(trace);
    traceSize = new TextEncoder().encode(normalized).byteLength;
    if (traceSize > MAX_SHARED_TRACE_BYTES) return json({ error: "attempt_too_large" }, 413);
    traceKey = `progress/${member.choirId}/${member.memberId}/${body.pieceId}/${id}.json`;
    const stored = await env.PERFORMANCE_BUCKET.put(traceKey, normalized, {
      httpMetadata: { contentType: "application/json", cacheControl: "private, no-store" },
      customMetadata: { memberId: member.memberId, pieceId: body.pieceId, kind: "shared-pitch-profile" },
    });
    traceEtag = stored.etag;
  }

  const status = attemptStatus(completed, score, coverage);
  try {
    await env.AUTH_DB.prepare(
      `INSERT INTO practice_attempts(
         id, choir_id, member_id, piece_id, score_version_id, part_id, voice_part,
         started_from_beginning, reached_end, completed, score, coverage, voiced_ms,
         playback_rate, transpose, trace_key, trace_etag, trace_size, created_at, expires_at)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)`,
    ).bind(
      id, member.choirId, member.memberId, body.pieceId, body.scoreVersionId, body.partId,
      member.voicePart, startedFromBeginning ? 1 : 0, reachedEnd ? 1 : 0, completed ? 1 : 0,
      score, coverage, Math.round(voicedMs), playbackRate, transpose, traceKey, traceEtag,
      traceSize, createdAt, expiresAt,
    ).run();
    await env.AUTH_DB.prepare(
      `INSERT INTO member_piece_progress(
         choir_id,member_id,piece_id,status,first_practiced_at,last_practiced_at,last_completed_at,
         completion_count,latest_score,latest_coverage,best_score,best_coverage,max_completed_speed)
       VALUES(?1,?2,?3,?4,?5,?5,?6,?7,?8,?9,?10,?11,?12)
       ON CONFLICT(choir_id,member_id,piece_id) DO UPDATE SET
         status=CASE
           WHEN member_piece_progress.status='ready' OR excluded.status='ready' THEN 'ready'
           WHEN member_piece_progress.status='completed' OR excluded.status='completed' THEN 'completed'
           ELSE 'in_progress' END,
         last_practiced_at=excluded.last_practiced_at,
         last_completed_at=COALESCE(excluded.last_completed_at,member_piece_progress.last_completed_at),
         completion_count=member_piece_progress.completion_count+excluded.completion_count,
         latest_score=excluded.latest_score,latest_coverage=excluded.latest_coverage,
         best_score=CASE WHEN excluded.best_score IS NULL THEN member_piece_progress.best_score
           WHEN member_piece_progress.best_score IS NULL OR excluded.best_score>member_piece_progress.best_score
           THEN excluded.best_score ELSE member_piece_progress.best_score END,
         best_coverage=CASE WHEN excluded.best_coverage IS NULL THEN member_piece_progress.best_coverage
           WHEN member_piece_progress.best_coverage IS NULL OR excluded.best_coverage>member_piece_progress.best_coverage
           THEN excluded.best_coverage ELSE member_piece_progress.best_coverage END,
         max_completed_speed=CASE WHEN excluded.max_completed_speed IS NULL THEN member_piece_progress.max_completed_speed
           WHEN member_piece_progress.max_completed_speed IS NULL OR excluded.max_completed_speed>member_piece_progress.max_completed_speed
           THEN excluded.max_completed_speed ELSE member_piece_progress.max_completed_speed END`,
    ).bind(
      member.choirId, member.memberId, body.pieceId, status, createdAt,
      completed ? createdAt : null, completed ? 1 : 0, score, coverage,
      completed ? score : null, completed ? coverage : null, completed ? playbackRate : null,
    ).run();
  } catch (error) {
    if (traceKey && env.PERFORMANCE_BUCKET) await env.PERFORMANCE_BUCKET.delete(traceKey).catch(() => undefined);
    throw error;
  }
  return json({ accepted: true, completed, status, attemptId: id });
}

function requireDirector(member: MemberContext): Response | null {
  return member.roles.includes("director") ? null : json({ error: "not_authorized" }, 403);
}

async function setAssignment(request: Request, env: Env, member: MemberContext, pieceId: string): Promise<Response> {
  const denied = requireDirector(member);
  if (denied) return denied;
  if (!validId(pieceId) || !(await repertoirePart(env, pieceId))) return json({ error: "piece_not_found" }, 404);
  let body: { assigned?: unknown };
  try { body = await request.json(); } catch { return json({ error: "invalid_assignment" }, 400); }
  if (typeof body.assigned !== "boolean") return json({ error: "invalid_assignment" }, 400);
  const now = new Date().toISOString();
  await env.AUTH_DB.prepare(
    `INSERT INTO repertoire_assignments(choir_id,piece_id,active,assigned_by,assigned_at,updated_at)
     VALUES(?1,?2,?3,?4,?5,?5)
     ON CONFLICT(choir_id,piece_id) DO UPDATE SET active=excluded.active,
       assigned_by=excluded.assigned_by,updated_at=excluded.updated_at`,
  ).bind(member.choirId, pieceId, body.assigned ? 1 : 0, member.memberId, now).run();
  await env.AUTH_DB.prepare(
    `INSERT INTO authorization_audit(id,choir_id,target_member_id,event,details_json,recorded_at)
     VALUES(?1,?2,?3,'repertoire_assignment',?4,?5)`,
  ).bind(crypto.randomUUID(), member.choirId, member.memberId,
    JSON.stringify({ pieceId, assigned: body.assigned }), now).run();
  return json({ pieceId, assigned: body.assigned, updatedAt: now });
}

async function cockpitOverview(env: Env, member: MemberContext): Promise<Response> {
  const denied = requireDirector(member);
  if (denied) return denied;
  const [members, assignments, progress] = await Promise.all([
    rows<{ member_id: string; display_name: string; voice_part: VoicePart | null }>(env.AUTH_DB.prepare(
      `SELECT member_id,display_name,voice_part FROM authorized_members
       WHERE choir_id=?1 AND active=1 ORDER BY display_name`,
    ).bind(member.choirId)),
    rows<{ piece_id: string; assigned_at: string; updated_at: string }>(env.AUTH_DB.prepare(
      `SELECT piece_id,assigned_at,updated_at FROM repertoire_assignments
       WHERE choir_id=?1 AND active=1 ORDER BY assigned_at,piece_id`,
    ).bind(member.choirId)),
    rows<Record<string, unknown>>(env.AUTH_DB.prepare(
      `SELECT member_id,piece_id,status,first_practiced_at,last_practiced_at,last_completed_at,
              completion_count,latest_score,latest_coverage,best_score,best_coverage,max_completed_speed
       FROM member_piece_progress WHERE choir_id=?1`,
    ).bind(member.choirId)),
  ]);
  return json({
    members: members.map(item => ({ memberId: item.member_id, displayName: item.display_name, voicePart: item.voice_part })),
    assignments: assignments.map(item => ({ pieceId: item.piece_id, assignedAt: item.assigned_at, updatedAt: item.updated_at })),
    progress: progress.map(item => ({
      memberId: item.member_id, pieceId: item.piece_id, status: item.status,
      firstPracticedAt: item.first_practiced_at, lastPracticedAt: item.last_practiced_at,
      lastCompletedAt: item.last_completed_at, completionCount: item.completion_count,
      latestScore: item.latest_score, latestCoverage: item.latest_coverage,
      bestScore: item.best_score, bestCoverage: item.best_coverage,
      maxCompletedSpeed: item.max_completed_speed,
    })),
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q)));
  return sorted[index];
}

export function aggregateTraces(items: Array<{ memberId: string; voicePart: VoicePart; trace: SharedTraceDocument }>) {
  return VOICE_PARTS.flatMap(voicePart => {
    const attempts = items.filter(item => item.voicePart === voicePart);
    const distinctMembers = new Set(attempts.map(item => item.memberId));
    if (distinctMembers.size < 2) return [];
    const totalBeats = Math.max(...attempts.map(item => item.trace.totalBeats));
    const bins = Math.max(96, Math.min(480, Math.ceil(totalBeats * 4)));
    const perMember = attempts.map(item => {
      const grouped = new Map<number, SharedTraceSample[]>();
      for (const sample of item.trace.samples) {
        const bin = Math.max(0, Math.min(bins - 1, Math.round(sample.beat / totalBeats * (bins - 1))));
        const bucket = grouped.get(bin) ?? [];
        bucket.push(sample); grouped.set(bin, bucket);
      }
      return new Map([...grouped].map(([bin, values]) => [bin, {
        pitch: median(values.map(value => value.displayPitch)),
        target: median(values.map(value => value.targetPitch)),
        error: median(values.map(value => value.errorCents)),
      }]));
    });
    const points = [];
    for (let bin = 0; bin < bins; bin += 1) {
      const values = perMember.map(item => item.get(bin)).filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (values.length < 2) continue;
      const pitches = values.map(value => value.pitch);
      points.push({
        beat: Number((bin / (bins - 1) * totalBeats).toFixed(4)),
        pitch: Number(median(pitches).toFixed(4)),
        low: Number(quantile(pitches, .25).toFixed(4)),
        high: Number(quantile(pitches, .75).toFixed(4)),
        targetPitch: Number(median(values.map(value => value.target)).toFixed(4)),
        medianErrorCents: Number(median(values.map(value => value.error)).toFixed(2)),
        memberCount: values.length,
      });
    }
    const segmentBuckets = new Map<string, { metric: SegmentMetric; rates: number[] }>();
    for (const attempt of attempts) for (const segment of attempt.trace.segments) {
      if (!segment.sampleCount) continue;
      const key = `${segment.occurrence}:${segment.measureNumber}`;
      const bucket = segmentBuckets.get(key) ?? { metric: segment, rates: [] };
      bucket.rates.push(segment.outOfToleranceCount / segment.sampleCount * 100);
      segmentBuckets.set(key, bucket);
    }
    const difficulties = [...segmentBuckets.values()]
      .filter(item => item.rates.length >= 2)
      .map(item => ({ occurrence: item.metric.occurrence, measureNumber: item.metric.measureNumber,
        startBeat: item.metric.startBeat, endBeat: item.metric.endBeat,
        outOfTolerancePercent: Number(median(item.rates).toFixed(1)), memberCount: item.rates.length }))
      .sort((a, b) => b.outOfTolerancePercent - a.outOfTolerancePercent);
    return [{ voicePart, memberCount: distinctMembers.size, totalBeats, points, difficulties }];
  });
}

async function latestTracesForPiece(
  env: Env,
  member: MemberContext,
  pieceId: string,
  scoreVersionId: string,
  requestedVoicePart?: VoicePart,
) {
  if (!env.PERFORMANCE_BUCKET) throw new Error("performance bucket unavailable");
  const cutoff = new Date().toISOString();
  const voiceClause = requestedVoicePart ? "AND a.voice_part = ?5" : "";
  const statement = env.AUTH_DB.prepare(
    `SELECT a.id,a.member_id,m.display_name,a.voice_part,a.part_id,a.trace_key,a.created_at FROM practice_attempts a
     JOIN authorized_members m ON m.member_id=a.member_id
     WHERE a.choir_id=?1 AND a.piece_id=?2 AND a.score_version_id=?3
       AND a.completed=1 AND a.playback_rate=1
       AND a.transpose=0 AND a.trace_key IS NOT NULL AND a.expires_at>?4 AND m.active=1
       ${voiceClause}
       AND a.id=(SELECT a2.id FROM practice_attempts a2
         WHERE a2.choir_id=a.choir_id AND a2.piece_id=a.piece_id AND a2.member_id=a.member_id
           AND a2.score_version_id=a.score_version_id AND a2.voice_part=a.voice_part
           AND a2.completed=1 AND a2.playback_rate=1
           AND a2.transpose=0 AND a2.trace_key IS NOT NULL AND a2.expires_at>?4
         ORDER BY a2.created_at DESC,a2.id DESC LIMIT 1)`,
  );
  const attempts = await rows<AttemptRow>(requestedVoicePart
    ? statement.bind(member.choirId, pieceId, scoreVersionId, cutoff, requestedVoicePart)
    : statement.bind(member.choirId, pieceId, scoreVersionId, cutoff));
  const traces = (await Promise.all(attempts.map(async attempt => {
    const object = await env.PERFORMANCE_BUCKET!.get(attempt.trace_key);
    if (!object) return null;
    try {
      const trace = parseSharedTrace(JSON.parse(await object.text()));
      return trace ? {
        id: attempt.id,
        memberId: attempt.member_id,
        displayName: attempt.display_name,
        voicePart: attempt.voice_part,
        partId: attempt.part_id,
        trace,
      } : null;
    } catch { return null; }
  }))).filter((item): item is NonNullable<typeof item> => Boolean(item));
  return traces;
}

async function aggregateForPiece(
  env: Env,
  member: MemberContext,
  pieceId: string,
  scoreVersionId: string,
  requestedVoicePart?: VoicePart,
) {
  return aggregateTraces(await latestTracesForPiece(env, member, pieceId, scoreVersionId, requestedVoicePart));
}

async function memberAggregate(env: Env, member: MemberContext, pieceId: string): Promise<Response> {
  const context = validId(pieceId) ? await repertoirePart(env, pieceId) : null;
  if (!context) return json({ error: "piece_not_found" }, 404);
  if (!member.voicePart) return json({ pieceId, parts: [] });
  return json({ pieceId, parts: await aggregateForPiece(env, member, pieceId, context.scoreVersionId, member.voicePart) });
}

async function cockpitPiece(env: Env, member: MemberContext, pieceId: string): Promise<Response> {
  const denied = requireDirector(member);
  if (denied) return denied;
  const context = validId(pieceId) ? await repertoirePart(env, pieceId) : null;
  if (!context) return json({ error: "piece_not_found" }, 404);
  const [members, performances, traces] = await Promise.all([
    rows<Record<string, unknown>>(env.AUTH_DB.prepare(
      `SELECT m.member_id,m.display_name,m.voice_part,p.status,p.last_practiced_at,p.last_completed_at,
              p.completion_count,p.latest_score,p.latest_coverage,p.best_score,p.best_coverage,
              p.max_completed_speed
       FROM authorized_members m LEFT JOIN member_piece_progress p
         ON p.member_id=m.member_id AND p.choir_id=m.choir_id AND p.piece_id=?2
       WHERE m.choir_id=?1 AND m.active=1 ORDER BY m.display_name`,
    ).bind(member.choirId, pieceId)),
    rows<Record<string, unknown>>(env.AUTH_DB.prepare(
      `SELECT p.id,p.member_id,m.display_name,m.voice_part,p.part_id,p.score,p.coverage,p.improved_at
       FROM best_performances p JOIN authorized_members m ON m.member_id=p.member_id
       WHERE p.choir_id=?1 AND p.piece_id=?2 AND p.score_version_id=?3
         AND m.active=1 ORDER BY m.display_name`,
    ).bind(member.choirId, pieceId, context.scoreVersionId)),
    latestTracesForPiece(env, member, pieceId, context.scoreVersionId),
  ]);
  return json({
    pieceId,
    scoreVersionId: context.scoreVersionId,
    members: members.map(item => ({
      memberId: item.member_id, displayName: item.display_name, voicePart: item.voice_part,
      status: item.status ?? "not_started", lastPracticedAt: item.last_practiced_at,
      lastCompletedAt: item.last_completed_at, completionCount: item.completion_count ?? 0,
      latestScore: item.latest_score, latestCoverage: item.latest_coverage,
      bestScore: item.best_score, bestCoverage: item.best_coverage,
      maxCompletedSpeed: item.max_completed_speed,
    })),
    performances: performances.map(item => ({
      id: item.id, memberId: item.member_id, displayName: item.display_name,
      voicePart: item.voice_part, partId: item.part_id, score: item.score, coverage: item.coverage,
      improvedAt: item.improved_at, imageUrl: `/api/performances/${encodeURIComponent(String(item.id))}/image`,
    })),
    parts: aggregateTraces(traces),
    traces: traces.map(item => ({
      id: item.id,
      memberId: item.memberId,
      displayName: item.displayName,
      voicePart: item.voicePart,
      partId: item.partId,
      trace: item.trace,
    })),
  });
}

async function revokePieceSharing(env: Env, member: MemberContext, pieceId: string): Promise<Response> {
  if (!validId(pieceId)) return json({ error: "piece_not_found" }, 404);
  const attempts = await rows<{ trace_key: string | null }>(env.AUTH_DB.prepare(
    `SELECT trace_key FROM practice_attempts
     WHERE choir_id=?1 AND member_id=?2 AND piece_id=?3`,
  ).bind(member.choirId, member.memberId, pieceId));
  const performances = await rows<{ image_key: string }>(env.AUTH_DB.prepare(
    `SELECT image_key FROM best_performances
     WHERE choir_id=?1 AND member_id=?2 AND piece_id=?3`,
  ).bind(member.choirId, member.memberId, pieceId));
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(
      "DELETE FROM practice_attempts WHERE choir_id=?1 AND member_id=?2 AND piece_id=?3",
    ).bind(member.choirId, member.memberId, pieceId),
    env.AUTH_DB.prepare(
      "DELETE FROM member_piece_progress WHERE choir_id=?1 AND member_id=?2 AND piece_id=?3",
    ).bind(member.choirId, member.memberId, pieceId),
    env.AUTH_DB.prepare(
      "DELETE FROM best_performances WHERE choir_id=?1 AND member_id=?2 AND piece_id=?3",
    ).bind(member.choirId, member.memberId, pieceId),
  ]);
  if (env.PERFORMANCE_BUCKET) {
    for (const key of [
      ...attempts.map(item => item.trace_key).filter((value): value is string => Boolean(value)),
      ...performances.map(item => item.image_key),
    ]) {
      try {
        await env.PERFORMANCE_BUCKET.delete(key);
        await env.AUTH_DB.batch([
          env.AUTH_DB.prepare("DELETE FROM practice_attempt_object_cleanup WHERE object_key=?1").bind(key),
          env.AUTH_DB.prepare("DELETE FROM performance_object_cleanup WHERE image_key=?1").bind(key),
        ]);
      } catch { /* D1 triggers preserve cleanup work for the scheduled retry. */ }
    }
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function handleProgressApi(
  request: Request,
  env: Env,
  member: MemberContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/progress/consent") return consentStatus(env, member);
  if (request.method === "POST" && url.pathname === "/api/progress/consent") return acceptTerms(request, env, member);
  if (request.method === "GET" && url.pathname === "/api/progress/assignments") return listAssignments(env, member);
  if (request.method === "GET" && url.pathname === "/api/progress/repertoire") return repertoireOverview(env, member);
  if (request.method === "POST" && url.pathname === "/api/progress/attempts") return submitAttempt(request, env, member);
  const revokeMatch = /^\/api\/progress\/pieces\/([^/]+)$/.exec(url.pathname);
  if (request.method === "DELETE" && revokeMatch) {
    return revokePieceSharing(env, member, decodeURIComponent(revokeMatch[1]));
  }
  const aggregateMatch = /^\/api\/progress\/pieces\/([^/]+)\/aggregate$/.exec(url.pathname);
  if (request.method === "GET" && aggregateMatch) {
    return memberAggregate(env, member, decodeURIComponent(aggregateMatch[1]));
  }
  if (request.method === "GET" && url.pathname === "/api/cockpit/overview") return cockpitOverview(env, member);
  const assignmentMatch = /^\/api\/cockpit\/assignments\/([^/]+)$/.exec(url.pathname);
  if (request.method === "PUT" && assignmentMatch) {
    return setAssignment(request, env, member, decodeURIComponent(assignmentMatch[1]));
  }
  const pieceMatch = /^\/api\/cockpit\/pieces\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && pieceMatch) return cockpitPiece(env, member, decodeURIComponent(pieceMatch[1]));
  return url.pathname.startsWith("/api/progress/") || url.pathname.startsWith("/api/cockpit/")
    ? json({ error: "api_not_found" }, 404) : null;
}

export async function purgeExpiredPracticeAttempts(env: Env, inactiveRetentionDays = 30): Promise<number> {
  if (!env.PERFORMANCE_BUCKET) return 0;
  const now = new Date().toISOString();
  const inactiveCutoff = new Date(Date.now() - inactiveRetentionDays * 86_400_000).toISOString();
  const expired = await rows<{ id: string; trace_key: string | null }>(env.AUTH_DB.prepare(
    `SELECT a.id,a.trace_key FROM practice_attempts a
     JOIN authorized_members m ON m.member_id=a.member_id
     WHERE a.expires_at<=?1 OR (m.active=0 AND m.revoked_at IS NOT NULL AND m.revoked_at<=?2)
     ORDER BY a.expires_at LIMIT 200`,
  ).bind(now, inactiveCutoff));
  let removed = 0;
  for (const item of expired) {
    try {
      const result = await env.AUTH_DB.prepare("DELETE FROM practice_attempts WHERE id=?1").bind(item.id).run();
      removed += result.meta.changes ?? 0;
      if (item.trace_key) {
        await env.PERFORMANCE_BUCKET.delete(item.trace_key);
        await env.AUTH_DB.prepare("DELETE FROM practice_attempt_object_cleanup WHERE object_key=?1")
          .bind(item.trace_key).run();
      }
    } catch { /* The trigger leaves the object queued for a later retry. */ }
  }
  const queued = await rows<{ object_key: string }>(env.AUTH_DB.prepare(
    "SELECT object_key FROM practice_attempt_object_cleanup ORDER BY queued_at LIMIT 200",
  ));
  for (const item of queued) {
    try {
      await env.PERFORMANCE_BUCKET.delete(item.object_key);
      await env.AUTH_DB.prepare("DELETE FROM practice_attempt_object_cleanup WHERE object_key=?1")
        .bind(item.object_key).run();
    } catch { /* Preserve the queue row for the next run. */ }
  }
  await env.AUTH_DB.prepare(
    `DELETE FROM member_piece_progress WHERE member_id IN (
       SELECT member_id FROM authorized_members
       WHERE active=0 AND revoked_at IS NOT NULL AND revoked_at<=?1
     )`,
  ).bind(inactiveCutoff).run();
  return removed;
}
