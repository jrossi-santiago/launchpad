import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import {
  buildMockHeatCheckRead,
  callSonnetHeatCheck,
  type HeatCheckCard,
} from "@/lib/anthropic/heatcheck";
import {
  HEATCHECK_RANGE_HOURS,
  fetchHeatCheckPosts,
  normaliseNiche,
} from "@/lib/getx/heatcheck";
import {
  HEAT_CHECK_DAILY_LIMIT,
  getHeatCheckUsage,
  recordHeatCheck,
} from "@/lib/usage/heatChecks";

// A search plus ten Sonnet reads, four at a time. Sonnet is slower than
// the Haiku work elsewhere, so the route asks for room to finish rather
// than being cut off holding reads it already paid for.
export const maxDuration = 120;

const READ_CONCURRENCY = 4;

// Nothing here is written to the database. HeatCheck is deliberately a
// thing you press, look at, and walk away from: the cards live in the
// tab's own state and are gone when you leave it. Saving a post you want
// to keep is what the Queue button on the card is for.
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
      { error: "Build your Brand Pack before running a HeatCheck." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null);
  const niche = normaliseNiche(
    body && typeof body === "object" && typeof (body as { niche?: unknown }).niche === "string"
      ? (body as { niche: string }).niche
      : "",
  );

  if (!niche) {
    return NextResponse.json(
      { error: "Say what your niche is before running a HeatCheck." },
      { status: 400 },
    );
  }

  try {
    const usage = await getHeatCheckUsage(supabase, user.id);
    if (usage.remaining <= 0) {
      return NextResponse.json(
        {
          error: `That's all ${HEAT_CHECK_DAILY_LIMIT} HeatChecks for today. They reset at midnight UTC.`,
          usage,
        },
        { status: 429 },
      );
    }

    const { posts, minFaves } = await fetchHeatCheckPosts(niche);

    if (posts.length === 0) {
      // No model calls were made, so this press is free — usage is
      // returned unchanged and nothing is recorded.
      return NextResponse.json({ cards: [], usage });
    }

    const cards: HeatCheckCard[] = [];
    for (let i = 0; i < posts.length; i += READ_CONCURRENCY) {
      const batch = posts.slice(i, i + READ_CONCURRENCY);
      const read = await Promise.all(
        batch.map(async (post) => {
          try {
            const result = process.env.ANTHROPIC_API_KEY
              ? await callSonnetHeatCheck(brandPack as BrandPackRow, post)
              : buildMockHeatCheckRead(post);
            return { ...post, read: result } satisfies HeatCheckCard;
          } catch (error) {
            // One post the model could not write for does not sink the
            // other nine — it is dropped and the rest of the run stands.
            console.error("heatcheck read failed", post.x_tweet_id, error);
            return null;
          }
        }),
      );
      cards.push(...read.filter((card): card is HeatCheckCard => card !== null));
    }

    if (cards.length === 0) {
      return NextResponse.json(
        { error: "Couldn't write comments for anything in that niche. Try again.", usage },
        { status: 502 },
      );
    }

    await recordHeatCheck(supabase, user.id, {
      niche,
      minFaves,
      rangeHours: HEATCHECK_RANGE_HOURS,
      posts: posts.length,
      cards: cards.length,
    });

    const after = await getHeatCheckUsage(supabase, user.id);
    return NextResponse.json({ cards, usage: after });
  } catch (error) {
    console.error("heatcheck/run failed", error);
    return NextResponse.json(
      { error: "HeatCheck failed. Please try again." },
      { status: 502 },
    );
  }
}
