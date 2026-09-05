# Sunset: Radar and Explore

Both tabs were removed when the app went to four tabs — **Scheduler**,
**HeatCheck**, **Commenter**, **You**. This file is the record of what they
did, what is still in the tree, and how to bring them back.

Last commit with the tabs live: `7bc2c26`. Restore any deleted file with
`git show 7bc2c26:<path> > <path>`.

## Why they went

The four-tab shape follows one idea: you get known by being the most useful
person in threads other people already care about, and you convert that
recognition on your own posts. That makes the daily loop **Commenter** (the
accounts you watch), **HeatCheck** (what is hot enough to be worth a comment
in the next hour) and **Scheduler** (your own posts). Radar and Explore were
both *discovery of strangers by keyword* — a fourth way in, competing with
HeatCheck for the same minutes, and the one with the weakest signal: a
keyword match says a post is about your topic, not that it is worth being
early to.

## Radar (`/radar`)

Search X on your own query with filters, and send results into the queue.

- Page: `app/(app)/radar/page.tsx` — read the brand pack, built a default
  query with `buildDefaultRadarQuery()`, rendered `RadarSearch` with
  `minFaves: 20` and `rangeHours: 72`.
- UI: `components/radar/RadarSearch.tsx` (query box, min-faves and range
  controls, cursor paging, add-to-queue), `ResultCard.tsx` (one result plus
  its `whyItMatched` line and draft state), `ResultCardSkeleton.tsx`.
- On **Add** it made two awaited calls: `POST /api/radar/add` to put the post
  in `tweets`, then `POST /api/drafts/regenerate` to write the three Haiku
  reply drafts. That pair is still the app's add-then-draft path.

## Explore (`/explore`)

Radar with the search box pre-filled from the brand pack, so the tab opened
on results rather than an empty input.

- Page: `app/(app)/explore/page.tsx`.
- UI: `components/explore/ExploreTab.tsx` — a chip row from
  `buildExploreQueries(pack)`, each chip an ordinary `POST /api/radar/search`,
  results reusing Radar's cards and the mobile `QuickCommentSheet`.
- The chips were deliberately string work, not a model call: each ICP bullet
  and the positioning line lowercased, punctuation and stopwords dropped,
  first four content words kept. No cost, no migration, same output every
  time.

## What is still in the tree (nothing to restore)

- `POST /api/radar/add` — **still used**, by HeatCheck and by the quick
  comment sheet's "Draft replies for this post".
- `POST /api/radar/search` — kept intact, with its cache and
  `lib/usage/radar.ts` daily cap. Nothing calls it now; it is the whole
  search path, ready if keyword discovery comes back.
- `lib/getx/search.ts` — `searchTweets()`, `buildDefaultRadarQuery()` and
  `buildExploreQueries()` all still exported. The last two have no caller.
- `/radar` and `/explore` now redirect to `/heatcheck` rather than 404.

## If they come back

The likely shape is not a tab. It is a **saved search** inside Commenter —
section 6 of the commenter system asks for a handful of standing searches in
buyer language ("churned because", "can't get first 10", "raised prices and")
whose hits land in the same stream as the accounts you watch, rather than in
a separate place you have to remember to visit. `searchTweets()` and the
result cards above are most of that work already.
