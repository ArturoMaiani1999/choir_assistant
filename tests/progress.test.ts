import { describe, expect, it } from "vitest";

import { aggregateTraces, canonicalVoicePart, handleProgressApi, parseSharedTrace } from "../src/progress";
import type { Env, MemberContext } from "../src/types";

function trace(pitches: number[]) {
  return {
    version: 1 as const,
    totalBeats: 4,
    samples: pitches.map((displayPitch, index) => ({
      beat: index, displayPitch, targetPitch: 60, errorCents: (displayPitch - 60) * 100,
    })),
    segments: [{
      occurrence: 0, measureNumber: "1", startBeat: 0, endBeat: 4,
      sampleCount: pitches.length,
      outOfToleranceCount: pitches.filter(value => Math.abs(value - 60) > 1).length,
    }],
  };
}

describe("director cockpit progress", () => {
  it.each(["tenore", null])("loads a private repertoire snapshot with preferred voice %s", async preferredVoicePart => {
    const bindings: unknown[][] = [];
    const assetRequests: string[] = [];
    const env = {
      APP_ORIGIN: "https://choir.example",
      AUTH_DB: {
        prepare(query: string) {
          expect(query).toContain("a.active = 1");
          expect(query).toContain("p.member_id = ?2");
          return {
            bind(...values: unknown[]) {
              bindings.push(values);
              return { async all() { return { results: [{ piece_id: "ave-verum", status: null }] }; } };
            },
          };
        },
      },
      ASSETS: {
        async fetch(request: Request) {
          assetRequests.push(request.url);
          return Response.json({ pieces: [
            { piece_id: "ave-verum", title: "Ave verum", parts: [{ id: "P3", name: "Tenore" }] },
            { piece_id: "not-assigned", title: "Other piece", parts: [] },
          ] });
        },
      },
    } as unknown as Env;
    const member: MemberContext = {
      memberId: "member-one", choirId: "choir-one", displayName: "Singer",
      voicePart: "basso", preferredVoicePart: preferredVoicePart as "tenore" | null,
      roles: ["singer"], groupIds: [], viewableGroupIds: [],
    };
    const response = await handleProgressApi(new Request(
      "https://choir.example/api/progress/repertoire?memberId=other&choirId=other",
    ), env, member);
    expect(bindings).toEqual([["choir-one", "member-one"]]);
    expect(assetRequests).toEqual(["https://choir.example/library.json"]);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(await response?.json()).toEqual({
      voicePart: preferredVoicePart ?? "basso", canDirect: false,
      assignments: [{ pieceId: "ave-verum", status: "not_started", completionCount: 0 }],
      pieces: [{ piece_id: "ave-verum", title: "Ave verum", parts: [{ id: "P3", name: "Tenore" }] }],
    });
  });

  it("fails the repertoire snapshot when its catalog is unavailable", async () => {
    const env = {
      APP_ORIGIN: "https://choir.example",
      AUTH_DB: { prepare() { return { bind() { return { async all() { return { results: [] }; } }; } }; } },
      ASSETS: { async fetch() { return new Response(null, { status: 503 }); } },
    } as unknown as Env;
    const member: MemberContext = {
      memberId: "member-one", choirId: "choir-one", displayName: "Singer",
      voicePart: null, roles: ["singer"], groupIds: [], viewableGroupIds: [],
    };
    await expect(handleProgressApi(new Request("https://choir.example/api/progress/repertoire"), env, member))
      .rejects.toThrow("Repertoire catalog unavailable");
  });

  it("normalizes the four supported Italian voice parts", () => {
    expect(canonicalVoicePart("Soprano")).toBe("soprano");
    expect(canonicalVoicePart("Contralto")).toBe("contralto");
    expect(canonicalVoicePart("Tenore")).toBe("tenore");
    expect(canonicalVoicePart("Basso")).toBe("basso");
  });

  it("rejects malformed or oversized shared traces", () => {
    expect(parseSharedTrace(trace([60, 61]))).not.toBeNull();
    expect(parseSharedTrace({ ...trace([60]), totalBeats: -1 })).toBeNull();
    expect(parseSharedTrace({ ...trace([60]), samples: [] })).toBeNull();
  });

  it("does not expose an aggregate before two distinct singers exist", () => {
    expect(aggregateTraces([
      { memberId: "one", voicePart: "tenore", trace: trace([60, 61]) },
    ])).toEqual([]);
  });

  it("builds a median and IQR plume per voice part", () => {
    const result = aggregateTraces([
      { memberId: "one", voicePart: "tenore", trace: trace([59, 60, 61]) },
      { memberId: "two", voicePart: "tenore", trace: trace([61, 62, 63]) },
      { memberId: "three", voicePart: "basso", trace: trace([48, 49]) },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ voicePart: "tenore", memberCount: 2 });
    expect(result[0].points.length).toBeGreaterThan(0);
    expect(result[0].difficulties[0]).toMatchObject({ measureNumber: "1", memberCount: 2 });
  });

  it("returns each singer's status together with the active assignments", async () => {
    let bound: unknown[] = [];
    const database = {
      prepare(query: string) {
        expect(query).toContain("LEFT JOIN member_piece_progress");
        const statement = {
          bind(...values: unknown[]) { bound = values; return statement; },
          async all() {
            return { results: [{
              piece_id: "o-sacrum", assigned_at: "2026-10-16T10:00:00.000Z",
              updated_at: "2026-10-16T10:00:00.000Z", status: "completed",
              first_practiced_at: "2026-10-16T11:00:00.000Z",
              last_practiced_at: "2026-10-16T12:00:00.000Z",
              last_completed_at: "2026-10-16T12:00:00.000Z", completion_count: 2,
              latest_score: 78, latest_coverage: 91, best_score: 84,
              best_coverage: 94, max_completed_speed: 0.9,
            }] };
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    const env = { AUTH_DB: database } as Env;
    const member: MemberContext = {
      memberId: "member-one", choirId: "choir-one", displayName: "Singer",
      voicePart: "tenore", roles: ["singer"], groupIds: [], viewableGroupIds: [],
    };
    const response = await handleProgressApi(
      new Request("https://choir.example/api/progress/assignments"), env, member,
    );

    expect(bound).toEqual(["choir-one", "member-one"]);
    expect(await response?.json()).toEqual({ assignments: [{
      pieceId: "o-sacrum", assignedAt: "2026-10-16T10:00:00.000Z",
      updatedAt: "2026-10-16T10:00:00.000Z", status: "completed",
      firstPracticedAt: "2026-10-16T11:00:00.000Z",
      lastPracticedAt: "2026-10-16T12:00:00.000Z",
      lastCompletedAt: "2026-10-16T12:00:00.000Z", completionCount: 2,
      latestScore: 78, latestCoverage: 91, bestScore: 84,
      bestCoverage: 94, maxCompletedSpeed: 0.9,
    }] });
  });
});
