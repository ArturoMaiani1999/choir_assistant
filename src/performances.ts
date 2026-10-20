import { canViewOwner } from "./authorization";
import { parseSharedTrace } from "./progress";
import type { Env, MemberContext } from "./types";

export const SCORING_PROFILE = "pitch-v1-original-100-complete-c60";
export const MIN_COVERAGE = 60;
export const MAX_PNG_BYTES = 4 * 1024 * 1024;
export const MAX_PNG_WIDTH = 4096;
export const MAX_PNG_HEIGHT = 2048;

interface PerformanceRow {
  id: string;
  choir_id: string;
  member_id: string;
  display_name: string;
  owner_active: number;
  piece_id: string;
  score_version_id: string;
  part_id: string;
  scoring_profile: string;
  score: number;
  coverage: number;
  image_key: string;
  image_etag: string;
  image_size: number;
  created_at: string;
  improved_at: string;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function normalizePersonName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (normalized.length < 1 || normalized.length > 60 ||
      !/^[\p{L}\p{M}][\p{L}\p{M}'’ -]*$/u.test(normalized)) return null;
  return normalized;
}

async function updateOwnProfile(request: Request, env: Env, member: MemberContext): Promise<Response> {
  let body: { firstName?: unknown; lastName?: unknown; preferredVoicePart?: unknown };
  try { body = await request.json(); } catch { return json({ error: "invalid_profile" }, 400); }
  const firstName = normalizePersonName(body.firstName ?? member.firstName);
  const lastName = normalizePersonName(body.lastName ?? member.lastName);
  if (!firstName || !lastName) return json({ error: "invalid_profile" }, 400);
  const preference = body.preferredVoicePart === undefined ? member.preferredVoicePart ?? null : body.preferredVoicePart;
  if (preference !== null && (typeof preference !== 'string' || !['soprano','contralto','tenore','basso'].includes(preference))) return json({ error: "invalid_voice_part" }, 400);
  const displayName = `${firstName} ${lastName}`;
  const now = new Date().toISOString();
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(
      `UPDATE authorized_members
       SET first_name=?1,last_name=?2,display_name=?3,profile_completed_at=?4,updated_at=?4,preferred_voice_part=?7
       WHERE member_id=?5 AND choir_id=?6 AND active=1`,
    ).bind(firstName, lastName, displayName, now, member.memberId, member.choirId, preference),
    env.AUTH_DB.prepare(
      `INSERT INTO authorization_audit(id,choir_id,target_member_id,event,details_json,recorded_at)
       VALUES(?1,?2,?3,'member_profile_updated',?4,?5)`,
    ).bind(crypto.randomUUID(), member.choirId, member.memberId,
      JSON.stringify({ displayName, preferredVoicePart: preference }), now),
  ]);
  return json({
    member: { id: member.memberId, displayName, firstName, lastName },
    profileCompleted: true,
    preferredVoicePart: preference,
  });
}

function summary(row: PerformanceRow): Record<string, unknown> {
  return {
    id: row.id,
    owner: { id: row.member_id, displayName: row.display_name },
    pieceId: row.piece_id,
    scoreVersionId: row.score_version_id,
    partId: row.part_id,
    scoringProfile: row.scoring_profile,
    score: row.score,
    coverage: row.coverage,
    imageUrl: `/api/performances/${encodeURIComponent(row.id)}/image`,
    analysisUrl: `/api/performances/${encodeURIComponent(row.id)}/analysis`,
    createdAt: row.created_at,
    improvedAt: row.improved_at,
  };
}

async function rows<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

const PERFORMANCE_SELECT = `
  SELECT p.*, m.display_name, m.active AS owner_active
  FROM best_performances p
  JOIN authorized_members m ON m.member_id = p.member_id`;

async function ownerGroupIds(env: Env, memberId: string): Promise<string[]> {
  return (await rows<{ group_id: string }>(env.AUTH_DB.prepare(
    `SELECT gm.group_id FROM group_memberships gm
     JOIN choir_groups g ON g.id = gm.group_id
     JOIN authorized_members m ON m.member_id = gm.member_id
     WHERE gm.member_id = ?1 AND gm.active = 1 AND g.active = 1 AND g.choir_id = m.choir_id`,
  ).bind(memberId))).map(({ group_id }) => group_id);
}

async function performanceById(env: Env, id: string): Promise<PerformanceRow | null> {
  return env.AUTH_DB.prepare(`${PERFORMANCE_SELECT} WHERE p.id = ?1 LIMIT 1`)
    .bind(id).first<PerformanceRow>();
}

async function canReadRow(env: Env, member: MemberContext, row: PerformanceRow): Promise<boolean> {
  return canViewOwner(member, {
    memberId: row.member_id,
    choirId: row.choir_id,
    active: row.owner_active === 1,
    groupIds: await ownerGroupIds(env, row.member_id),
  });
}

function validId(value: FormDataEntryValue | null): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

export function inspectPng(bytes: ArrayBuffer): { width: number; height: number } | null {
  if (bytes.byteLength < 24 || bytes.byteLength > MAX_PNG_BYTES) return null;
  const view = new DataView(bytes);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((value, index) => view.getUint8(index) !== value)) return null;
  if (String.fromCharCode(...new Uint8Array(bytes, 12, 4)) !== "IHDR") return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width > MAX_PNG_WIDTH || height > MAX_PNG_HEIGHT) return null;
  return { width, height };
}

export async function validRepertoireContext(
  env: Env,
  pieceId: string,
  scoreVersionId: string,
  partId: string,
): Promise<boolean> {
  const url = new URL(`/library-assets/${encodeURIComponent(pieceId)}/bundle.json`, "https://assets.invalid");
  const response = await env.ASSETS.fetch(new Request(url));
  if (!response.ok) return false;
  const bundle = await response.json<{
    piece_id?: string;
    score_version_id?: string;
    published?: boolean;
    parts?: Array<{ id?: string }>;
  }>();
  return bundle.published === true && bundle.piece_id === pieceId &&
    bundle.score_version_id === scoreVersionId &&
    (bundle.parts ?? []).some(part => part.id === partId);
}

async function listMine(env: Env, member: MemberContext): Promise<Response> {
  const result = await rows<PerformanceRow>(env.AUTH_DB.prepare(
    `${PERFORMANCE_SELECT}
     WHERE p.member_id = ?1 AND p.choir_id = ?2 AND m.active = 1
     ORDER BY p.improved_at DESC`,
  ).bind(member.memberId, member.choirId));
  return json({ performances: result.map(summary) });
}

async function listGroups(env: Env, member: MemberContext): Promise<Response> {
  const director = member.roles.includes("director");
  if (!director && !member.roles.includes("section_viewer")) return json({ groups: [] });
  const result = director
    ? await rows<{ id: string; code: string; name: string }>(env.AUTH_DB.prepare(
      "SELECT id, code, name FROM choir_groups WHERE choir_id = ?1 AND active = 1 ORDER BY name",
    ).bind(member.choirId))
    : await rows<{ id: string; code: string; name: string }>(env.AUTH_DB.prepare(
      `SELECT g.id, g.code, g.name FROM choir_groups g
       JOIN performance_view_grants v ON v.group_id = g.id
       WHERE v.viewer_member_id = ?1 AND v.active = 1
         AND g.choir_id = ?2 AND g.active = 1 ORDER BY g.name`,
    ).bind(member.memberId, member.choirId));
  return json({ groups: result });
}

async function listGroup(env: Env, member: MemberContext, groupId: string): Promise<Response> {
  const allowed = member.roles.includes("director") ||
    (member.roles.includes("section_viewer") && member.viewableGroupIds.includes(groupId));
  if (!allowed) return json({ error: "group_not_found" }, 404);
  const group = await env.AUTH_DB.prepare(
    "SELECT id, code, name FROM choir_groups WHERE id = ?1 AND choir_id = ?2 AND active = 1 LIMIT 1",
  ).bind(groupId, member.choirId).first<{ id: string; code: string; name: string }>();
  if (!group) return json({ error: "group_not_found" }, 404);
  const result = await rows<PerformanceRow>(env.AUTH_DB.prepare(
    `${PERFORMANCE_SELECT}
     JOIN group_memberships gm ON gm.member_id = p.member_id
     WHERE gm.group_id = ?1 AND gm.active = 1 AND p.choir_id = ?2 AND m.active = 1
     ORDER BY m.display_name, p.piece_id, p.improved_at DESC`,
  ).bind(groupId, member.choirId));
  return json({ group, performances: result.map(summary) });
}

async function readImage(env: Env, member: MemberContext, id: string): Promise<Response> {
  if (!env.PERFORMANCE_BUCKET) throw new Error("performance bucket unavailable");
  const row = await performanceById(env, id);
  if (!row || !(await canReadRow(env, member, row))) {
    return json({ error: "performance_not_found" }, 404);
  }
  const object = await env.PERFORMANCE_BUCKET.get(row.image_key);
  if (!object) throw new Error("referenced performance image missing");
  return new Response(object.body, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(object.size),
      ETag: object.httpEtag,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readAnalysis(env: Env, member: MemberContext, id: string): Promise<Response> {
  if (!env.PERFORMANCE_BUCKET) throw new Error("performance bucket unavailable");
  const performance = await performanceById(env, id);
  if (!performance || !(await canReadRow(env, member, performance))) {
    return json({ error: "performance_not_found" }, 404);
  }
  const attempt = await env.AUTH_DB.prepare(
    `SELECT id,score,coverage,trace_key,created_at
     FROM practice_attempts
     WHERE choir_id=?1 AND member_id=?2 AND piece_id=?3 AND score_version_id=?4
       AND part_id=?5 AND completed=1 AND playback_rate=1 AND transpose=0
       AND trace_key IS NOT NULL AND expires_at>?6
     ORDER BY ABS(score-?7), ABS(julianday(created_at)-julianday(?8)), created_at DESC
     LIMIT 1`,
  ).bind(
    performance.choir_id, performance.member_id, performance.piece_id,
    performance.score_version_id, performance.part_id, new Date().toISOString(),
    performance.score, performance.improved_at,
  ).first<{ id: string; score: number; coverage: number; trace_key: string; created_at: string }>();
  if (!attempt) return json({ error: "analysis_not_available" }, 404);
  const object = await env.PERFORMANCE_BUCKET.get(attempt.trace_key);
  if (!object) return json({ error: "analysis_not_available" }, 404);
  let trace;
  try { trace = parseSharedTrace(JSON.parse(await object.text())); }
  catch { trace = null; }
  if (!trace) return json({ error: "analysis_not_available" }, 404);
  return json({
    performanceId: performance.id,
    attemptId: attempt.id,
    score: attempt.score,
    coverage: attempt.coverage,
    createdAt: attempt.created_at,
    trace,
  });
}

async function submitBest(request: Request, env: Env, member: MemberContext): Promise<Response> {
  if (!env.PERFORMANCE_BUCKET) throw new Error("performance bucket unavailable");
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PNG_BYTES + 64 * 1024) {
    return json({ error: "invalid_performance" }, 400);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid_performance" }, 400);
  }
  const pieceId = form.get("pieceId");
  const scoreVersionId = form.get("scoreVersionId");
  const partId = form.get("partId");
  const profile = form.get("scoringProfile");
  const score = Number(form.get("score"));
  const coverage = Number(form.get("coverage"));
  const completed = form.get("completed") === "true";
  const image = form.get("image");
  if (!validId(pieceId) || !validId(scoreVersionId) || !validId(partId) ||
      profile !== SCORING_PROFILE || !Number.isInteger(score) || score < 0 || score > 100 ||
      !Number.isFinite(coverage) || coverage < MIN_COVERAGE || coverage > 100 || !completed ||
      !(image instanceof File) || image.type !== "image/png" || image.size > MAX_PNG_BYTES) {
    return json({ error: "invalid_performance" }, 400);
  }
  if (!(await validRepertoireContext(env, pieceId, scoreVersionId, partId))) {
    return json({ error: "invalid_performance" }, 400);
  }
  const bytes = await image.arrayBuffer();
  if (!inspectPng(bytes)) return json({ error: "invalid_performance" }, 400);

  const now = new Date().toISOString();
  const candidateKey = `performances/${member.choirId}/${member.memberId}/${pieceId}/${crypto.randomUUID()}.png`;
  const previous = await env.AUTH_DB.prepare(
    `SELECT image_key FROM best_performances
     WHERE member_id = ?1 AND piece_id = ?2 AND score_version_id = ?3
       AND part_id = ?4 AND scoring_profile = ?5 LIMIT 1`,
  ).bind(member.memberId, pieceId, scoreVersionId, partId, profile)
    .first<{ image_key: string }>();
  const stored = await env.PERFORMANCE_BUCKET.put(candidateKey, bytes, {
    httpMetadata: { contentType: "image/png", cacheControl: "private, no-store" },
    customMetadata: { memberId: member.memberId, pieceId, scoringProfile: profile },
  });
  try {
    const accepted = await env.AUTH_DB.prepare(
      `INSERT INTO best_performances(
         id, choir_id, member_id, piece_id, score_version_id, part_id,
         scoring_profile, score, coverage, image_key, image_etag, image_size,
         created_at, improved_at)
       VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
       ON CONFLICT(member_id, piece_id, score_version_id, part_id, scoring_profile)
       DO UPDATE SET score=excluded.score, coverage=excluded.coverage,
         image_key=excluded.image_key, image_etag=excluded.image_etag,
         image_size=excluded.image_size, improved_at=excluded.improved_at
       WHERE excluded.score > best_performances.score
       RETURNING id`,
    ).bind(
      crypto.randomUUID(), member.choirId, member.memberId, pieceId, scoreVersionId,
      partId, profile, score, coverage, candidateKey, stored.etag, bytes.byteLength, now,
    ).first<{ id: string }>();
    if (!accepted) {
      await env.PERFORMANCE_BUCKET.delete(candidateKey);
      const current = await env.AUTH_DB.prepare(
        `${PERFORMANCE_SELECT}
         WHERE p.member_id = ?1 AND p.piece_id = ?2 AND p.score_version_id = ?3
           AND p.part_id = ?4 AND p.scoring_profile = ?5 LIMIT 1`,
      ).bind(member.memberId, pieceId, scoreVersionId, partId, profile).first<PerformanceRow>();
      return json({ updated: false, performance: current ? summary(current) : null });
    }
    if (previous?.image_key && previous.image_key !== candidateKey) {
      try {
        await env.PERFORMANCE_BUCKET.delete(previous.image_key);
        await env.AUTH_DB.prepare(
          "DELETE FROM performance_object_cleanup WHERE image_key = ?1",
        ).bind(previous.image_key).run();
      } catch {
        // The D1 trigger keeps the old key queued for scheduled cleanup.
      }
    }
    const current = await performanceById(env, accepted.id);
    return json({ updated: true, performance: current ? summary(current) : null });
  } catch (error) {
    await env.PERFORMANCE_BUCKET.delete(candidateKey).catch(() => undefined);
    throw error;
  }
}

async function deleteOwn(env: Env, member: MemberContext, id: string): Promise<Response> {
  if (!env.PERFORMANCE_BUCKET) throw new Error("performance bucket unavailable");
  const deleted = await env.AUTH_DB.prepare(
    "DELETE FROM best_performances WHERE id = ?1 AND member_id = ?2 AND choir_id = ?3 RETURNING image_key",
  ).bind(id, member.memberId, member.choirId).first<{ image_key: string }>();
  if (!deleted) return json({ error: "performance_not_found" }, 404);
  try {
    await env.PERFORMANCE_BUCKET.delete(deleted.image_key);
    await env.AUTH_DB.prepare(
      "DELETE FROM performance_object_cleanup WHERE image_key = ?1",
    ).bind(deleted.image_key).run();
  } catch {
    // Deletion is already authoritative in D1; the cleanup queue will retry R2.
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function handlePerformanceApi(
  request: Request,
  env: Env,
  member: MemberContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/me") {
    return json({
      member: {
        id: member.memberId,
        displayName: member.displayName,
        firstName: member.firstName ?? null,
        lastName: member.lastName ?? null,
      },
      profileCompleted: member.profileCompleted === true,
      voicePart: member.voicePart,
      preferredVoicePart: member.preferredVoicePart ?? null,
      roles: member.roles,
      groupIds: member.groupIds,
      viewableGroupIds: member.viewableGroupIds,
      canViewAllGroups: member.roles.includes("director"),
    });
  }
  if (request.method === "PATCH" && url.pathname === "/api/me") {
    return updateOwnProfile(request, env, member);
  }
  if (request.method === "GET" && url.pathname === "/api/performances/mine") return listMine(env, member);
  if (request.method === "GET" && url.pathname === "/api/groups") return listGroups(env, member);
  const groupMatch = /^\/api\/groups\/([^/]+)\/performances$/.exec(url.pathname);
  if (request.method === "GET" && groupMatch) return listGroup(env, member, decodeURIComponent(groupMatch[1]));
  const imageMatch = /^\/api\/performances\/([^/]+)\/image$/.exec(url.pathname);
  if (request.method === "GET" && imageMatch) return readImage(env, member, decodeURIComponent(imageMatch[1]));
  const analysisMatch = /^\/api\/performances\/([^/]+)\/analysis$/.exec(url.pathname);
  if (request.method === "GET" && analysisMatch) return readAnalysis(env, member, decodeURIComponent(analysisMatch[1]));
  if (request.method === "POST" && url.pathname === "/api/performances/best") return submitBest(request, env, member);
  const deleteMatch = /^\/api\/performances\/([^/]+)$/.exec(url.pathname);
  if (request.method === "DELETE" && deleteMatch) return deleteOwn(env, member, decodeURIComponent(deleteMatch[1]));
  return json({ error: "api_not_found" }, 404);
}

export async function purgeExpiredInactivePerformances(env: Env, retentionDays = 30): Promise<number> {
  if (!env.PERFORMANCE_BUCKET) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const expired = await rows<{ id: string; image_key: string }>(env.AUTH_DB.prepare(
    `SELECT p.id, p.image_key FROM best_performances p
     JOIN authorized_members m ON m.member_id = p.member_id
     WHERE m.active = 0 AND m.revoked_at IS NOT NULL AND m.revoked_at <= ?1
     ORDER BY m.revoked_at LIMIT 100`,
  ).bind(cutoff));
  let removed = 0;
  for (const item of expired) {
    try {
      await env.PERFORMANCE_BUCKET.delete(item.image_key);
      const result = await env.AUTH_DB.prepare(
        "DELETE FROM best_performances WHERE id = ?1 AND image_key = ?2",
      ).bind(item.id, item.image_key).run();
      removed += result.meta.changes ?? 0;
    } catch {
      // Keep the D1 pointer so a later scheduled run can retry this object.
    }
  }
  const queued = await rows<{ image_key: string }>(env.AUTH_DB.prepare(
    "SELECT image_key FROM performance_object_cleanup ORDER BY queued_at LIMIT 100",
  ));
  for (const item of queued) {
    try {
      await env.PERFORMANCE_BUCKET.delete(item.image_key);
      await env.AUTH_DB.prepare(
        "DELETE FROM performance_object_cleanup WHERE image_key = ?1",
      ).bind(item.image_key).run();
    } catch {
      // Preserve the queue row for the next scheduled retry.
    }
  }
  return removed;
}

