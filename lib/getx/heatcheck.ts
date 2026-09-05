import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import {
  buildDefaultRadarQuery,
  buildMockSearchResults,
  fetchTweetSearch,
} from "@/lib/getx/search";
import type { FetchedTweet } from "@/lib/getx/tweet";

// HeatCheck's whole premise is hype you can still catch, so the window is
// fixed at 24 hours and is not a setting. A post from Tuesday is not a
// heat check.
export const HEATCHECK_RANGE_HOURS = 24;

// Ten posts per press: enough that a couple of duds do not empty the tab,
// few enough that ten Sonnet reads stay inside a single wait.
export const HEATCHECK_POST_COUNT = 10;

// "Best performing" is a floor, not a sort — X's own Top ranking does the
// ordering, and min_faves decides what gets to be ranked at all. A niche
// wide enough for 500-like posts and a niche where 30 is a big day are
// both real, so the ladder walks down until there is something to read
// rather than showing an empty tab for a query that was merely quiet.
const MIN_FAVES_LADDER = [200, 50, 10] as const;

export function buildDefaultNiche(brandPack: BrandPackRow): string {
  return buildDefaultRadarQuery(brandPack);
}

// The niche line is editable in the tab, so it arrives as free text. It
// goes to GetXAPI as a query, where a stray operator ("from:", "since:")
// would quietly change what the search means — strip them, and cap the
// length so a pasted paragraph cannot become the query.
export function normaliseNiche(input: string): string {
  return input
    .replace(/\b[a-z_]+:\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export async function fetchHeatCheckPosts(
  niche: string,
): Promise<{ posts: FetchedTweet[]; minFaves: number }> {
  for (const minFaves of MIN_FAVES_LADDER) {
    const params = {
      query: niche,
      minFaves,
      rangeHours: HEATCHECK_RANGE_HOURS,
      product: "Top" as const,
      cursor: "",
    };

    const { results } = process.env.GETX_API_KEY
      ? await fetchTweetSearch(params)
      : buildMockSearchResults(params);

    // Rung accepted as soon as it has something worth reading. A rung
    // that came back thin still beats dropping to a lower floor when it
    // filled the page — only a genuinely empty one walks down.
    if (results.length > 0) {
      const posts = [...results]
        .sort((a, b) => b.engagement_score - a.engagement_score)
        .slice(0, HEATCHECK_POST_COUNT);
      return { posts, minFaves };
    }
  }

  return { posts: [], minFaves: MIN_FAVES_LADDER[MIN_FAVES_LADDER.length - 1] };
}
