"use client";

import { useCallback, useEffect, useState } from "react";
import type { NetworkStack } from "@/lib/network/stack";
import { ProfileStack } from "@/components/network/ProfileStack";
import type { SendState } from "@/components/network/NetworkCard";

export function NetworkBoard({
  initialStacks,
  maxProfiles,
  initialError = null,
}: {
  initialStacks: NetworkStack[];
  maxProfiles: number;
  // Set when the server-side read failed, so the board opens saying why
  // rather than looking like an empty Network.
  initialError?: string | null;
}) {
  const [stacks, setStacks] = useState<NetworkStack[]>(initialStacks);
  const [handleInput, setHandleInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [activeIndexes, setActiveIndexes] = useState<Record<string, number>>({});
  const [focusedColumn, setFocusedColumn] = useState(0);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});

  // Refresh runs when the page loads and when the button is clicked —
  // there is no polling timer, by design. The page-load call leaves force
  // unset, so accounts polled in the last few minutes are skipped server
  // side and re-opening the tab costs nothing; the button forces every
  // account. Written as a promise chain to match the pattern in
  // RadarSearch (the setState-in-effect lint rule traces through async
  // functions but not .then() chains).
  // No synchronous setState in here: the caller sets the spinner before
  // calling, which keeps the mount-time call clear of the
  // set-state-in-effect rule (same shape as RadarSearch's performSearch).
  const refresh = useCallback((force = false) => {
    fetch("/api/network/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `Refresh failed (${response.status}).`);
        }
        setStacks((body?.stacks ?? []) as NetworkStack[]);
        setRefreshing(false);
      })
      .catch((err) => {
        setRefreshing(false);
        setError(err instanceof Error ? err.message : "Failed to refresh Network.");
      });
  }, []);

  useEffect(() => {
    // Fires once, on page load. A hard refresh of the browser re-runs it;
    // nothing else does.
    if (initialStacks.length > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function activeIndexFor(stack: NetworkStack): number {
    const stored = activeIndexes[stack.profile.id] ?? 0;
    return stored < stack.cards.length ? stored : 0;
  }

  function setActiveIndex(profileId: string, index: number) {
    setActiveIndexes((prev) => ({ ...prev, [profileId]: index }));
  }

  // Drops one card from a stack locally so the next one slides up without
  // waiting for a round trip.
  function dropCard(profileId: string, cardId: string) {
    setStacks((prev) =>
      prev.map((stack) =>
        stack.profile.id === profileId
          ? { ...stack, cards: stack.cards.filter((card) => card.id !== cardId) }
          : stack,
      ),
    );
    setActiveIndexes((prev) => ({ ...prev, [profileId]: 0 }));
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (adding || !handleInput.trim()) return;

    setAdding(true);
    setError(null);
    try {
      const response = await fetch("/api/network/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: handleInput }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? `Couldn't add that account (${response.status}).`);
      }
      setStacks((body?.stacks ?? []) as NetworkStack[]);
      setHandleInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that account.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(profileId: string, handle: string) {
    if (!window.confirm(`Stop watching @${handle}?`)) {
      return;
    }

    setError(null);
    try {
      const response = await fetch("/api/network/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile_id: profileId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? `Couldn't remove that account (${response.status}).`);
      }
      setStacks((body?.stacks ?? []) as NetworkStack[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that account.");
    }
  }

  async function handleSkip(profileId: string, cardId: string) {
    dropCard(profileId, cardId);
    try {
      await fetch("/api/network/skip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ card_id: cardId }),
      });
    } catch {
      // The card is already gone from the board; the next refresh will put
      // it back if the write really failed.
    }
  }

  async function handleSend(profileId: string, cardId: string) {
    if (sendStates[cardId] === "sending") return;
    setSendStates((prev) => ({ ...prev, [cardId]: "sending" }));
    setError(null);

    try {
      const response = await fetch("/api/network/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ card_id: cardId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? `Couldn't send that post (${response.status}).`);
      }

      dropCard(profileId, cardId);

      // Second, separate, fully-awaited request — the same
      // POST /api/drafts/regenerate that the queue calls after an add, rather
      // than a second draft-generating code path.
      const tweetId = body?.tweet?.id as string | undefined;
      if (!tweetId) {
        setSendStates((prev) => ({ ...prev, [cardId]: "ready" }));
        return;
      }

      setSendStates((prev) => ({ ...prev, [cardId]: "drafting" }));
      try {
        const draftResponse = await fetch("/api/drafts/regenerate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tweet_id: tweetId }),
        });
        if (!draftResponse.ok) throw new Error("Draft generation failed.");
        setSendStates((prev) => ({ ...prev, [cardId]: "ready" }));
      } catch {
        setSendStates((prev) => ({ ...prev, [cardId]: "failed" }));
      }
    } catch (err) {
      setSendStates((prev) => ({ ...prev, [cardId]: "idle" }));
      setError(err instanceof Error ? err.message : "Couldn't send that post.");
    }
  }

  // Arrow keys move between columns and up and down a stack, so a morning
  // pass never needs the mouse. Ignored while typing in the add box.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (stacks.length === 0) return;

      const column = Math.min(focusedColumn, stacks.length - 1);
      const stack = stacks[column];

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setFocusedColumn(Math.max(0, column - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setFocusedColumn(Math.min(stacks.length - 1, column + 1));
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (stack.cards.length === 0) return;
        event.preventDefault();
        const current = activeIndexes[stack.profile.id] ?? 0;
        const next =
          event.key === "ArrowDown"
            ? Math.min(stack.cards.length - 1, current + 1)
            : Math.max(0, current - 1);
        setActiveIndex(stack.profile.id, next);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stacks, focusedColumn, activeIndexes]);

  const totalCards = stacks.reduce((sum, stack) => sum + stack.cards.length, 0);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Network</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Watch the accounts that matter to you. Their latest original posts
          — no replies, no retweets — load when you open this page, ready to
          send to Launchpad.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <form onSubmit={handleAdd} className="flex flex-1 gap-2">
            <input
              type="text"
              value={handleInput}
              onChange={(event) => setHandleInput(event.target.value)}
              placeholder="@handle or x.com/handle"
              className="min-w-48 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <button
              type="submit"
              disabled={adding || !handleInput.trim()}
              className="shrink-0 rounded-full bg-zinc-900 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {adding ? "Adding…" : "Watch"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setRefreshing(true);
              refresh(true);
            }}
            disabled={refreshing || stacks.length === 0}
            className="shrink-0 rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
          {stacks.length}/{maxProfiles} accounts watched · {totalCards} posts waiting ·
          ←/→ between people, ↑/↓ through a stack
        </p>

        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </div>

      {stacks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white px-8 py-24 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Nobody in your Network yet.
          </p>
          <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Add the handle of someone worth replying to. Their latest posts
            load straight away, and the stack refills each time you come
            back.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
          {stacks.map((stack, index) => (
            <ProfileStack
              key={stack.profile.id}
              stack={stack}
              activeIndex={activeIndexFor(stack)}
              isFocused={index === focusedColumn}
              onFocus={() => setFocusedColumn(index)}
              onSelectCard={(cardIndex) => setActiveIndex(stack.profile.id, cardIndex)}
              onSend={() => {
                const card = stack.cards[activeIndexFor(stack)];
                if (card) void handleSend(stack.profile.id, card.id);
              }}
              onSkip={() => {
                const card = stack.cards[activeIndexFor(stack)];
                if (card) void handleSkip(stack.profile.id, card.id);
              }}
              onRemove={() => void handleRemove(stack.profile.id, stack.profile.handle)}
              sendStates={sendStates}
            />
          ))}
        </div>
      )}
    </div>
  );
}
