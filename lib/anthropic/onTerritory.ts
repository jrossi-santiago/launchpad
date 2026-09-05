import type { BrandPackRow } from "@/lib/anthropic/brandPack";

// Which posts in a sweep are actually about what this founder works on.
//
// This is the gate that keeps the agenda out of almost every reply. It
// runs once per sweep, sees only the post text — never the replies — and
// returns the handful worth writing from the founder's own corner of the
// subject. Everything it does not pick is written voice-only, and cannot
// carry a slant because the request never contains one.
//
// One call for the whole batch rather than one per post, deliberately:
// judged side by side, "is this the same field?" becomes "which of these
// twenty is most the same field?", which is the question that actually
// produces a short list. Asked one post at a time, a model says yes to
// almost anything with a plausible connection — and a plausible
// connection to everything is how we got here.

// At most one card in five, and never more than this many. The cap is the
// real safeguard: a model that decides everything is on-territory just
// gets its list truncated, newest first, rather than turning the sweep
// back into what it was.
export const ON_TERRITORY_RATIO = 5;
export const ON_TERRITORY_MAX = 4;

export type TerritoryCandidate = {
  id: string;
  handle: string;
  content: string | null;
};

export function territoryBudget(candidateCount: number): number {
  return Math.min(ON_TERRITORY_MAX, Math.floor(candidateCount / ON_TERRITORY_RATIO));
}

const PICK_TOOL = {
  name: "pick_on_territory",
  description:
    "Pick the posts that are genuinely about the founder's own field. Picking none is a normal answer.",
  input_schema: {
    type: "object",
    properties: {
      picks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: {
              type: "integer",
              description: "The post's index, as numbered in the input.",
            },
            subject: {
              type: "string",
              description:
                "The thing this post is about that overlaps the founder's field. Concrete — a topic, not a category.",
            },
          },
          required: ["index", "subject"],
        },
        description:
          "The qualifying posts, most clearly on-topic first. Empty when none qualify.",
      },
    },
    required: ["picks"],
  },
} as const;

const SYSTEM_PROMPT = [
  "You are given a founder's field of work and a numbered list of posts from accounts they watch.",
  "Pick only the posts that are genuinely ABOUT that field — where someone who works in it would have something to say that a smart outsider could not.",
  "",
  "Judge the posts against each other, not one at a time. You are looking for the few that stand out as on-topic, not everything with a connection.",
  "",
  "Do not pick a post because:",
  "- it mentions a word from the founder's field in passing",
  "- it is about business, startups, marketing or software in general, and so is the founder",
  "- the author would make a good customer — that is not what this is asking",
  "- you could construct a link with a sentence of setup. If it takes a bridge, it does not qualify.",
  "",
  "Most posts will not qualify. An empty list is the right answer more often than a full one, and picking nothing is better than picking something you had to argue for.",
].join("\n");

type Pick = { index: number; subject: string };

function isPickList(input: unknown): input is { picks: Pick[] } {
  if (!input || typeof input !== "object") return false;
  const picks = (input as { picks?: unknown }).picks;
  return (
    Array.isArray(picks) &&
    picks.every(
      (pick) =>
        pick &&
        typeof pick === "object" &&
        typeof (pick as { index?: unknown }).index === "number",
    )
  );
}

// Returns the ids judged on-territory, capped. Never throws: a gate that
// fails should cost the sweep its handful of on-territory replies, not the
// sweep itself — so a failure means everything is written voice-only,
// which is the safe direction to fail in.
export async function pickOnTerritory(
  brandPack: BrandPackRow,
  candidates: TerritoryCandidate[],
): Promise<Set<string>> {
  const budget = territoryBudget(candidates.length);
  if (budget === 0 || !process.env.ANTHROPIC_API_KEY) return new Set();

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              founder_field: {
                positioning: brandPack.business_summary,
                icp: brandPack.icp,
              },
              at_most: budget,
              posts: candidates.map((candidate, index) => ({
                index,
                author: `@${candidate.handle}`,
                text: candidate.content ?? "",
              })),
            }),
          },
        ],
        tools: [PICK_TOOL],
        tool_choice: { type: "tool", name: "pick_on_territory" },
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API responded with ${response.status}`);
    }

    const data = await response.json();
    const content: unknown[] = Array.isArray(data?.content) ? data.content : [];
    const toolUse = content.find(
      (block): block is { type: "tool_use"; name: string; input: unknown } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "tool_use" &&
        (block as { name?: unknown }).name === "pick_on_territory",
    );

    if (!toolUse || !isPickList(toolUse.input)) return new Set();

    const picked = new Set<string>();
    for (const pick of toolUse.input.picks) {
      if (picked.size >= budget) break;
      const candidate = candidates[pick.index];
      if (candidate) picked.add(candidate.id);
    }

    return picked;
  } catch (error) {
    console.error("on-territory gate failed; writing voice-only", error);
    return new Set();
  }
}
