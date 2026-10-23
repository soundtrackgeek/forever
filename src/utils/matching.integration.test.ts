import { beforeAll, expect, it } from "vitest";
import { prepareMatchingRuntime, runMatching } from "../../scripts/matching-runtime.mjs";
import fixture from "../../fixtures/matching.json";
import type { RankedSourceResponse } from "./smartMatches";

beforeAll(async () => { await prepareMatchingRuntime(); }, 120_000);

it("runs golden ranking and normalization fixtures through the real Rust bridge", async () => {
  for (const { sources, preferences, officialTracks, artist, ids, eligible, scores } of fixture.ranking) {
    const ranked = await runMatching("rank_album_sources", { sources, preferences, officialTracks, artist }) as RankedSourceResponse[];
    expect(ranked.map((r) => r.sourceId)).toEqual(ids);
    expect(ranked.map((r) => r.eligible)).toEqual(eligible);
    expect(ranked.map((r) => r.score)).toEqual(scores);
  }
  for (const { input, expected } of fixture.normalization) {
    expect(await runMatching("normalize_title", { value: input })).toBe(expected);
  }
});
