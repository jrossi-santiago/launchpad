import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import {
  buildMockAssist,
  callHaikuAssist,
  type AssistMode,
} from "@/lib/anthropic/assist";
import {
  buildMockGrokQuestion,
  callHaikuGrokQuestion,
} from "@/lib/anthropic/drafts";
import type { ReplyTarget } from "@/lib/anthropic/feedReply";
import { isCommentType, type CommentType } from "@/lib/anthropic/commentTypes";
import { getFeedWriteUsage, recordFeedWrite } from "@/lib/usage/feedWrites";

// One comment, for one post, on demand.
//
// This is the third of the three ways a comment gets written in this app,
// and it exists for the cards the other two leave empty. Reload
// (POST /api/feed/reload) sweeps every watched account and writes a reply
// per post, but it is allowed to decline — a post that turns on a link it
// cannot open comes back read and unanswered. The queue's three-draft
// pack (POST /api/drafts/regenerate) can answer anything, but it costs a
// queue row and one of twenty daily regenerations.
//
// So a declined card used to offer nothing but Done, which is the wrong
// end for the one kind of post where the founder knows more than the
// model does. Three buttons now sit on it, and this route is all three:
//
//   grok  — a @grok question, so the thing nobody could read gets read
//           publicly, in the thread. Reuses the generator the draft pack
//           has always had, retry and validation included.
//   ask   — the question the founder actually wants answered, written out
//           of the gap the model admitted to.
//   steer — the founder types the missing piece and the reply is written
//           with it as fact.
//
// One model call per press, so no maxDuration extension: this is the
// cheap button, unlike the sweep next door.
const MODES = new Set(["grok", "ask", "steer"]);

// The founder's note is the ground the `steer` reply stands on, so it has
// to be real — an empty box is not a fact — and it has to be a line
// rather than an essay. Long enough for "this is his Series A post and we
// shipped the same thing last year", short enough that nobody is pasting
// an article into a prompt.
const NOTE_MAX = 400;

type Body = {
  card_id?: unknown;
  mode?: unknown;
  note?: unknown;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const cardId = typeof body?.card_id === "string" ? body.card_id : null;
  const mode =
    typeof body?.mode === "string" && MODES.has(body.mode)
      ? (body.mode as "grok" | AssistMode)
      : null;
  const note =
    typeof body?.note === "string" ? body.note.trim().slice(0, NOTE_MAX) : "";

  if (!cardId || !mode) {
    return NextResponse.json({ error: "Missing card_id or mode." }, { status: 400 });
  }

  if (mode === "steer" && !note) {
    return NextResponse.json(
      { error: "Tell it what it was missing, then it can write the reply." },
      { status: 400 },
    );
  }

  const { data: brandPack } = await supabase
    .from("brand_packs")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!brandPack) {
    return NextResponse.json(
      { error: "Build your Brand Pack before it can write comments for you." },
      { status: 400 },
    );
  }

  const usage = await getFeedWriteUsage(supabase, user.id).catch(() => null);
  if (usage && usage.remaining <= 0) {
    return NextResponse.json(
      {
        error: `You've written all ${usage.limit} one-off comments for today. Reload still writes replies for new posts.`,
        usage,
      },
      { status: 429 },
    );
  }

  const { data: card, error: cardError } = await supabase
    .from("network_tweets")
    .select("id, profile_id, content, quoted, context, reply_unclear")
    .eq("id", cardId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (cardError) {
    console.error("feed/write-one load card failed", cardError);
    return NextResponse.json({ error: "Failed to write that comment." }, { status: 500 });
  }

  if (!card) {
    return NextResponse.json({ error: "That post is no longer in your Feed." }, { status: 404 });
  }

  // Who posted it. The bio is half of what a fragment of a post means —
  // the same sentence from a founder, a researcher and a comedian are
  // three different posts — and it is the reason this is a second query
  // rather than a card row read on its own.
  const { data: profile } = await supabase
    .from("network_profiles")
    .select("handle, display_name, bio")
    .eq("id", card.profile_id)
    .eq("user_id", user.id)
    .maybeSingle();

  const target: ReplyTarget = {
    handle: (profile?.handle as string | undefined) ?? "unknown",
    display_name: (profile?.display_name as string | null | undefined) ?? null,
    bio: (profile?.bio as string | null | undefined) ?? null,
    content: (card.content as string | null) ?? null,
    quoted: (card.quoted as ReplyTarget["quoted"]) ?? null,
    context: (card.context as ReplyTarget["context"]) ?? null,
  };

  const unclear = typeof card.reply_unclear === "string" ? card.reply_unclear : null;
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

  let text: string;
  let type: CommentType | null;

  try {
    if (mode === "grok") {
      const tweet = {
        author_handle: `@${target.handle}`,
        content: target.content,
      };
      text = hasKey
        ? await callHaikuGrokQuestion(brandPack as BrandPackRow, tweet)
        : buildMockGrokQuestion(tweet);
      // A @grok question is not one of the four comment types. It is its
      // own shape, and labelling it "sharp question" would put a chip on
      // the card claiming a check that was never run against it — the
      // same reason the three-draft pack stores its @grok draft typeless.
      type = null;
    } else {
      const result = hasKey
        ? await callHaikuAssist(brandPack as BrandPackRow, target, mode, {
            unclear,
            note: note || null,
          })
        : buildMockAssist(target, mode, { note: note || null });
      text = result.text;
      type = result.type;
    }
  } catch (error) {
    console.error(`feed/write-one ${mode} failed`, error);
    return NextResponse.json(
      { error: "Couldn't write that one. Try again, or try a different button." },
      { status: 502 },
    );
  }

  // Written onto the card, so a refresh does not lose it and the post
  // stops sitting in the Feed's declined band.
  //
  // The sweep id is borrowed from the newest sweep rather than minted
  // fresh. Both are wrong in the other direction: a null id sorts this
  // comment — written seconds ago, by hand — into the "carried over from
  // an earlier sweep" band and labels it Old, while a brand new id would
  // become the newest sweep and demote every reply the last Reload
  // actually wrote. Joining the sitting that is already on screen is the
  // honest answer, and a Feed with no sweep at all gets one of its own.
  const { data: newest } = await supabase
    .from("network_tweets")
    .select("reply_sweep_id")
    .eq("user_id", user.id)
    .not("reply_sweep_id", "is", null)
    .order("suggested_reply_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sweepId =
    (newest?.reply_sweep_id as string | null | undefined) ?? crypto.randomUUID();

  const { error: updateError } = await supabase
    .from("network_tweets")
    .update({
      suggested_reply: text,
      suggested_reply_at: new Date().toISOString(),
      // None of the three carries an ask. A CTA is only ever written for
      // a post judged to be about the founder's own field, and a post
      // nobody could follow well enough to reply to was never judged to
      // be about anything.
      suggested_cta: null,
      reply_type: isCommentType(type) ? type : null,
      reply_sweep_id: sweepId,
      // The decline is cleared: the card now has a comment on it, and
      // leaving "one for you to read" above a written reply would be the
      // card contradicting itself.
      reply_unclear: null,
    })
    .eq("id", card.id)
    .eq("user_id", user.id);

  if (updateError) {
    console.error("feed/write-one save failed", updateError);
    // The comment exists and is worth handing back even if the row did
    // not take it — the user is about to copy it into X either way.
  }

  await recordFeedWrite(supabase, user.id, {
    mode,
    card_id: card.id,
    // Kept for diagnostics: when a steered reply comes out wrong, the
    // note is the first thing worth reading.
    note: note || null,
  }).catch((error) => console.error("feed/write-one usage record failed", error));

  const refreshed = await getFeedWriteUsage(supabase, user.id).catch(() => usage);

  return NextResponse.json({ mode, text, type, usage: refreshed });
}
