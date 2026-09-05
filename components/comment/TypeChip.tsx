import {
  commentTypeSpec,
  isCommentType,
} from "@/lib/anthropic/commentTypes";

// Says which of the four shapes a comment is, wherever one is shown.
//
// It is on the card for the founder, not for decoration: the type is what
// the comment was written to be and checked against, so seeing "Receipts
// story" over a line with no story in it is the fastest way to catch a
// bad one before it goes out. The blurb rides along as the title, because
// the four names only teach themselves once.
export function TypeChip({ type }: { type: unknown }) {
  if (!isCommentType(type)) return null;
  const spec = commentTypeSpec(type);

  return (
    <span
      title={spec.blurb}
      className="w-fit shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
    >
      {spec.label}
    </span>
  );
}
