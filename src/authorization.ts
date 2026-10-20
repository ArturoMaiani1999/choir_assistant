import type { AuthenticatedIdentity, ChoirRole, Env, MemberContext, VoicePart } from "./types";

const encoder = new TextEncoder();

export function normalizeEmail(email: string): string {
  return email.trim().normalize("NFKC").toLowerCase();
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function emailDigest(email: string, secret: string): Promise<string> {
  if (secret.length < 32) {
    throw new Error("AUTH_EMAIL_HMAC_KEY must contain at least 32 characters");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    await crypto.subtle.sign("HMAC", key, encoder.encode(normalizeEmail(email))),
  );
}

export async function isAuthorized(
  identity: AuthenticatedIdentity,
  env: Env,
): Promise<boolean> {
  const digest = await emailDigest(identity.primaryEmail, env.AUTH_EMAIL_HMAC_KEY);
  const row = await env.AUTH_DB.prepare(
    "SELECT active FROM authorized_members WHERE email_digest = ?1 LIMIT 1",
  )
    .bind(digest)
    .first<{ active: number }>();
  return row?.active === 1;
}

interface MemberRow {
  member_id: string | null;
  choir_id: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  profile_completed_at: string | null;
  voice_part: VoicePart | null;
  preferred_voice_part: VoicePart | null;
  clerk_subject: string | null;
  active: number;
}

async function values<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

function validVoicePart(value: VoicePart | null): VoicePart | null {
  return value != null && ["soprano", "contralto", "tenore", "basso"].includes(value) ? value : null;
}

export async function resolveMember(
  identity: AuthenticatedIdentity,
  env: Env,
): Promise<MemberContext | null> {
  const digest = await emailDigest(identity.primaryEmail, env.AUTH_EMAIL_HMAC_KEY);
  let row = await env.AUTH_DB.prepare(
    `SELECT m.member_id, m.choir_id, m.display_name, m.first_name, m.last_name,
            m.profile_completed_at, m.voice_part, m.preferred_voice_part, m.clerk_subject, m.active
       FROM authorized_members m JOIN choirs c ON c.id = m.choir_id
       WHERE m.email_digest = ?1 AND c.active = 1 LIMIT 1`,
  ).bind(digest).first<MemberRow>();
  if (!row || row.active !== 1 || !row.member_id || !row.choir_id || !row.display_name) {
    return null;
  }

  if (row.clerk_subject == null) {
    await env.AUTH_DB.prepare(
      `UPDATE authorized_members SET clerk_subject = ?1, updated_at = ?2
       WHERE member_id = ?3 AND clerk_subject IS NULL`,
    ).bind(identity.subject, new Date().toISOString(), row.member_id).run();
    row = await env.AUTH_DB.prepare(
      `SELECT m.member_id, m.choir_id, m.display_name, m.first_name, m.last_name,
              m.profile_completed_at, m.voice_part, m.preferred_voice_part, m.clerk_subject, m.active
       FROM authorized_members m JOIN choirs c ON c.id = m.choir_id
       WHERE m.email_digest = ?1 AND c.active = 1 LIMIT 1`,
    ).bind(digest).first<MemberRow>();
  }
  if (!row || row.clerk_subject !== identity.subject || row.active !== 1 ||
      !row.member_id || !row.choir_id || !row.display_name) return null;

  const [roleRows, groupRows, grantRows] = await Promise.all([
    values<{ role: ChoirRole }>(env.AUTH_DB.prepare(
      "SELECT role FROM member_roles WHERE member_id = ?1 AND active = 1",
    ).bind(row.member_id)),
    values<{ group_id: string }>(env.AUTH_DB.prepare(
      `SELECT gm.group_id FROM group_memberships gm
       JOIN choir_groups g ON g.id = gm.group_id
       WHERE gm.member_id = ?1 AND gm.active = 1 AND g.active = 1 AND g.choir_id = ?2`,
    ).bind(row.member_id, row.choir_id)),
    values<{ group_id: string }>(env.AUTH_DB.prepare(
      `SELECT v.group_id FROM performance_view_grants v
       JOIN choir_groups g ON g.id = v.group_id
       WHERE v.viewer_member_id = ?1 AND v.active = 1 AND g.active = 1 AND g.choir_id = ?2`,
    ).bind(row.member_id, row.choir_id)),
  ]);
  const roles = new Set<ChoirRole>(["singer"]);
  roleRows.forEach(({ role }) => roles.add(role));
  return {
    memberId: row.member_id,
    choirId: row.choir_id,
    displayName: row.display_name,
    firstName: row.first_name,
    lastName: row.last_name,
    profileCompleted: row.profile_completed_at != null,
    voicePart: validVoicePart(row.voice_part),
    preferredVoicePart: validVoicePart(row.preferred_voice_part),
    roles: [...roles],
    groupIds: groupRows.map(({ group_id }) => group_id),
    viewableGroupIds: grantRows.map(({ group_id }) => group_id),
  };
}

export function canViewOwner(
  member: MemberContext,
  owner: { memberId: string; choirId: string; groupIds: string[]; active: boolean },
): boolean {
  if (!owner.active || owner.choirId !== member.choirId) return false;
  if (owner.memberId === member.memberId) return true;
  if (member.roles.includes("director")) return true;
  if (!member.roles.includes("section_viewer")) return false;
  const grants = new Set(member.viewableGroupIds);
  return owner.groupIds.some((groupId) => grants.has(groupId));
}
