import { describe, expect, it } from "vitest";

import { canViewOwner } from "../src/authorization";
import {
  MAX_PNG_HEIGHT,
  MAX_PNG_WIDTH,
  inspectPng,
  normalizePersonName,
  handlePerformanceApi,
} from "../src/performances";
import type { Env, MemberContext } from "../src/types";

function member(overrides: Partial<MemberContext> = {}): MemberContext {
  return {
    memberId: "member-viewer",
    choirId: "choir-a",
    displayName: "Viewer",
    voicePart: "tenore",
    roles: ["singer"],
    groupIds: ["tenors"],
    viewableGroupIds: [],
    ...overrides,
  };
}

function owner(overrides: Partial<Parameters<typeof canViewOwner>[1]> = {}) {
  return {
    memberId: "member-owner",
    choirId: "choir-a",
    groupIds: ["sopranos"],
    active: true,
    ...overrides,
  };
}

function pngHeader(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes.buffer;
}

describe("scoped performance authorization", () => {
  it("always lets an active member view their own same-choir performance", () => {
    const viewer = member();
    expect(canViewOwner(viewer, owner({ memberId: viewer.memberId }))).toBe(true);
  });

  it("lets section viewers read only intersecting grants", () => {
    const viewer = member({ roles: ["singer", "section_viewer"], viewableGroupIds: ["sopranos"] });
    expect(canViewOwner(viewer, owner())).toBe(true);
    expect(canViewOwner(viewer, owner({ groupIds: ["basses"] }))).toBe(false);
  });

  it("lets directors see the choir but never crosses choir boundaries", () => {
    const director = member({ roles: ["singer", "director"] });
    expect(canViewOwner(director, owner())).toBe(true);
    expect(canViewOwner(director, owner({ choirId: "choir-b" }))).toBe(false);
  });

  it("gives admins no implicit performance visibility and rejects inactive owners", () => {
    expect(canViewOwner(member({ roles: ["singer", "admin"] }), owner())).toBe(false);
    expect(canViewOwner(member({ roles: ["singer", "director"] }), owner({ active: false }))).toBe(false);
  });
});

describe("performance PNG validation", () => {
  it("accepts a bounded PNG header", () => {
    expect(inspectPng(pngHeader(1600, 760))).toEqual({ width: 1600, height: 760 });
  });

  it("rejects invalid signatures and excessive dimensions", () => {
    expect(inspectPng(new ArrayBuffer(24))).toBeNull();
    expect(inspectPng(pngHeader(MAX_PNG_WIDTH + 1, 760))).toBeNull();
    expect(inspectPng(pngHeader(1600, MAX_PNG_HEIGHT + 1))).toBeNull();
  });
});

describe("self-service member profile", () => {
  function profileApi() {
    const writes: { query: string; values: unknown[] }[] = [];
    const env = { AUTH_DB: {
      prepare(query: string) {
        return { bind(...values: unknown[]) { return { query, values }; } };
      },
      async batch(statements: typeof writes) { writes.push(...statements); return []; },
    } } as unknown as Env;
    const viewer = member({ firstName: "Anna", lastName: "Rossi", preferredVoicePart: "contralto" });
    const patch = (body: unknown) => handlePerformanceApi(new Request("https://choir.example.org/api/me", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), env, viewer);
    return { patch, writes, viewer };
  }

  it("persists a SATB preference without changing the authorized section or grants", async () => {
    const { patch, writes, viewer } = profileApi();
    const response = await patch({ preferredVoicePart: "soprano" });
    expect(response?.status).toBe(200);
    expect(await response!.json()).toMatchObject({
      preferredVoicePart: "soprano", member: { firstName: "Anna", lastName: "Rossi" },
    });
    expect(writes).toHaveLength(2);
    expect(writes[0].query).toContain("preferred_voice_part=?7");
    expect(writes[0].query).not.toMatch(/(?<!preferred_)voice_part\s*=/);
    expect(writes[0].query).toContain("member_id=?5 AND choir_id=?6 AND active=1");
    expect(writes[0].values.slice(4)).toEqual([viewer.memberId, viewer.choirId, "soprano"]);
    expect(viewer.voicePart).toBe("tenore");
    expect(viewer.groupIds).toEqual(["tenors"]);
  });

  it("keeps the preference on a name-only edit and permits clearing it explicitly", async () => {
    const { patch, writes } = profileApi();
    expect((await patch({ firstName: "Maria" }))?.status).toBe(200);
    expect(writes[0].values[6]).toBe("contralto");
    const cleared = await patch({ preferredVoicePart: null });
    expect(await cleared!.json()).toMatchObject({ preferredVoicePart: null });
    expect(writes[2].values[6]).toBeNull();
  });

  it.each(["alto", "director", [], ["soprano"], {}, 1])("rejects invalid vocal preferences before writing: %j", async (value) => {
    const { patch, writes } = profileApi();
    const response = await patch({ preferredVoicePart: value });
    expect(response?.status).toBe(400);
    expect(await response!.json()).toEqual({ error: "invalid_voice_part" });
    expect(writes).toHaveLength(0);
  });

  it("normalizes real names without flattening accents or apostrophes", () => {
    expect(normalizePersonName("  Federico   ")).toBe("Federico");
    expect(normalizePersonName("D’Angiò")).toBe("D’Angiò");
    expect(normalizePersonName("Anna-Maria")).toBe("Anna-Maria");
  });

  it("rejects empty, control-like, numeric and excessively long names", () => {
    expect(normalizePersonName(" ")).toBeNull();
    expect(normalizePersonName("Mario42")).toBeNull();
    expect(normalizePersonName("<script>")).toBeNull();
    expect(normalizePersonName("a".repeat(61))).toBeNull();
  });
});

