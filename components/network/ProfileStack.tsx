"use client";

import type { NetworkStack } from "@/lib/network/stack";
import { NetworkCard, formatAge, type SendState } from "@/components/network/NetworkCard";

// The fanned cards under the face-up one: enough of each to tell whether
// it's worth bringing to the top, and nothing more.
function PeekCard({
  text,
  age,
  offset,
  isQuote,
  onClick,
}: {
  text: string;
  age: string;
  offset: number;
  isQuote: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ marginTop: offset }}
      className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-left shadow-sm transition-transform hover:-translate-y-0.5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <span className="flex items-baseline gap-2">
        <span className="line-clamp-1 flex-1 text-xs text-zinc-500 dark:text-zinc-400">
          {/* Flags a quote tweet down in the fan, where there is no room
              for the block the face-up card shows. */}
          {isQuote ? <span aria-label="Quote tweet">↱ </span> : null}
          {text}
        </span>
        <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">{age}</span>
      </span>
    </button>
  );
}

export function ProfileStack({
  stack,
  activeIndex,
  isFocused,
  onFocus,
  onSelectCard,
  onSend,
  onSkip,
  onRemove,
  sendStates,
}: {
  stack: NetworkStack;
  activeIndex: number;
  isFocused: boolean;
  onFocus: () => void;
  onSelectCard: (index: number) => void;
  onSend: () => void;
  onSkip: () => void;
  onRemove: () => void;
  sendStates: Record<string, SendState>;
}) {
  const { profile, cards } = stack;
  const active = cards[activeIndex];
  const rest = cards.filter((_, index) => index !== activeIndex);
  const polledAge = formatAge(profile.last_polled_at);

  return (
    <section
      onMouseDown={onFocus}
      className={`flex w-80 shrink-0 flex-col gap-3 rounded-2xl p-3 transition-colors ${
        isFocused ? "bg-zinc-100 dark:bg-zinc-900/60" : "bg-transparent"
      }`}
    >
      <header className="flex items-center gap-3 px-1">
        {profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar_url}
            alt=""
            className="h-9 w-9 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {profile.handle.slice(0, 2).toUpperCase()}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {profile.display_name ?? `@${profile.handle}`}
          </p>
          <p className="flex items-center gap-1.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
            <span
              title={
                profile.last_error ??
                (polledAge ? `Checked ${polledAge} ago` : "Not checked yet")
              }
              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                profile.last_error ? "bg-amber-500" : "bg-zinc-400 dark:bg-zinc-600"
              }`}
            />
            @{profile.handle}
            {profile.followers_count !== null
              ? ` · ${profile.followers_count.toLocaleString()} followers`
              : ""}
          </p>
        </div>

        <button
          type="button"
          onClick={onRemove}
          title="Stop watching this account"
          className="shrink-0 rounded-full px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          ✕
        </button>
      </header>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Nothing new in the last day. Refresh to check for new posts.
        </div>
      ) : (
        <>
          {active ? (
            <NetworkCard
              card={active}
              handle={profile.handle}
              position={activeIndex}
              total={cards.length}
              onSend={onSend}
              onSkip={onSkip}
              sendState={sendStates[active.id] ?? "idle"}
            />
          ) : null}

          <div className="flex flex-col">
            {rest.map((card) => (
              <PeekCard
                key={card.id}
                text={card.content ?? ""}
                age={formatAge(card.posted_at)}
                offset={-6}
                isQuote={card.quoted !== null}
                onClick={() => onSelectCard(cards.indexOf(card))}
              />
            ))}
          </div>
        </>
      )}

      <p className="px-1 text-[11px] text-zinc-400 dark:text-zinc-500">
        {profile.last_error ?? (polledAge ? `Checked ${polledAge} ago` : "")}
      </p>
    </section>
  );
}
