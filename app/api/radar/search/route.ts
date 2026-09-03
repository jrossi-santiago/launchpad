import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildMockSearchResults,
  buildWhyItMatched,
  fetchTweetSearch,
  type RadarResult,
} from "@/lib/getx/search";
import type { FetchedTweet } from "@/lib/getx/tweet";
import { recordRadarSearchPage } from "@/lib/usage/radar";

const CACHE_WINDOW_MS = 6 * 60 * 60 * 1000;

async function attachAlreadySaved(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  query: string,
  results: FetchedTweet[],
): Promise<RadarResult[]> {
  if (results.length === 0) return [];

  const { data: existing, error } = await supabase
    .from("tweets")
    .select("x_tweet_id")
    .eq("user_id", userId)
    .in(
      "x_tweet_id",
      results.map((r) => r.x_tweet_id),
    );

  if (error) throw error;

  const savedIds = new Set((existing ?? []).map((row) => row.x_tweet_id as string));

  return results.map((result) => ({
    ...result,
    alreadySaved: savedIds.has(result.x_tweet_id),
    whyItMatched: buildWhyItMatched(result.content, query),
  }));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: brandPack } = await supabase
    .from("brand_packs")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!brandPack) {
    return NextResponse.json(
      { error: "Build your Brand Pack before searching Radar." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null);
  const query =
    body && typeof body === "object" && typeof (body as { query?: unknown }).query === "string"
      ? (body as { query: string }).query.trim()
      : "";
  const minFaves =
    body && typeof body === "object" && typeof (body as { min_faves?: unknown }).min_faves === "number"
      ? (body as { min_faves: number }).min_faves
      : NaN;
  const rangeHours =
    body && typeof body === "object" && typeof (body as { range_hours?: unknown }).range_hours === "number"
      ? (body as { range_hours: number }).range_hours
      : NaN;
  const product =
    body &&
    typeof body === "object" &&
    ((body as { product?: unknown }).product === "Top" ||
      (body as { product?: unknown }).product === "Latest")
      ? (body as { product: "Top" | "Latest" }).product
      : null;
  const cursor =
    body && typeof body === "object" && typeof (body as { cursor?: unknown }).cursor === "string"
      ? (body as { cursor: string }).cursor
      : "";

  if (!query || !Number.isFinite(minFaves) || !Number.isFinite(rangeHours) || !product) {
    return NextResponse.json(
      { error: "Missing or invalid query, min_faves, range_hours, or product." },
      { status: 400 },
    );
  }

  try {
    const { data: cached, error: cacheError } = await supabase
      .from("radar_search_cache")
      .select("*")
      .eq("user_id", user.id)
      .eq("query", query)
      .eq("product", product)
      .eq("min_faves", minFaves)
      .eq("range_hours", rangeHours)
      .eq("cursor", cursor)
      .maybeSingle();

    if (cacheError) throw cacheError;

    if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_WINDOW_MS) {
      const results = await attachAlreadySaved(
        supabase,
        user.id,
        query,
        cached.results as FetchedTweet[],
      );
      return NextResponse.json({ results, nextCursor: cached.next_cursor ?? null });
    }

    const params = { query, minFaves, rangeHours, product, cursor };
    const { results: fetched, nextCursor } = process.env.GETX_API_KEY
      ? await fetchTweetSearch(params)
      : buildMockSearchResults(params);

    const { error: upsertError } = await supabase.from("radar_search_cache").upsert(
      {
        user_id: user.id,
        query,
        product,
        min_faves: minFaves,
        range_hours: rangeHours,
        cursor,
        next_cursor: nextCursor,
        results: fetched,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "user_id,query,product,min_faves,range_hours,cursor" },
    );

    if (upsertError) throw upsertError;

    await recordRadarSearchPage(supabase, user.id, {
      query,
      product,
      minFaves,
      rangeHours,
      cursor,
    });

    const results = await attachAlreadySaved(supabase, user.id, query, fetched);
    return NextResponse.json({ results, nextCursor });
  } catch (error) {
    console.error("radar/search failed", error);
    return NextResponse.json(
      { error: "Failed to search Radar. Please try again." },
      { status: 502 },
    );
  }
}
