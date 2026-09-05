import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { upsertTweetRow } from "@/lib/getx/tweet";
import { cardToFetchedTweet, loadCard } from "@/lib/network/cardTweet";

// Sends one card into the Launchpad queue. This is deliberately the same
// upsertTweetRow() that POST /api/radar/add uses, so a card from Network
// and a result from Radar land in the queue identically; the client then
// calls POST /api/drafts/regenerate exactly as Radar does.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const cardId =
    body && typeof body === "object" && typeof (body as { card_id?: unknown }).card_id === "string"
      ? (body as { card_id: string }).card_id
      : "";

  if (!cardId) {
    return NextResponse.json({ error: "Missing card_id." }, { status: 400 });
  }

  const card = await loadCard(supabase, user.id, cardId).catch((error: unknown) => {
    console.error("network/send lookup failed", error);
    return undefined;
  });

  if (card === undefined) {
    return NextResponse.json({ error: "Failed to send that post." }, { status: 500 });
  }

  if (!card) {
    return NextResponse.json({ error: "That post isn't in your Network." }, { status: 404 });
  }

  try {
    const tweet = await upsertTweetRow(supabase, user.id, cardToFetchedTweet(card));

    const { error: updateError } = await supabase
      .from("network_tweets")
      .update({ state: "sent", tweet_id: tweet.id })
      .eq("id", card.id)
      .eq("user_id", user.id);

    if (updateError) throw updateError;

    return NextResponse.json({ tweet });
  } catch (error) {
    console.error("network/send failed", error);
    return NextResponse.json({ error: "Failed to send that post." }, { status: 502 });
  }
}
