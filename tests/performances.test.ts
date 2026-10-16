import { describe, expect, it } from "vitest";

import { canViewOwner } from "../src/authorization";
import {
  MAX_PNG_HEIGHT,
  MAX_PNG_WIDTH,
  inspectPng,
} from "../src/performances";
import type { MemberContext } from "../src/types";

function member(overrides: Partial<MemberContext> = {}): MemberContext {
  return {
    memberId: "member-viewer",
    choirId: "choir-a",
    displayName: "Viewer",
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

