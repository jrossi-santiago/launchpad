"use client";

import { useState } from "react";
import type { BrandPackRow, InterviewAnswers } from "@/lib/anthropic/brandPack";

const EMPTY_ANSWERS: InterviewAnswers = {
  what_you_sell: "",
  who_its_for: "",
  desired_next_action: "",
  example_posts: ["", ""],
  never_say: "",
};

const STEP_COUNT = 5;

type Props = {
  onComplete: (pack: BrandPackRow) => void;
  onCancel?: () => void;
};

export function InterviewWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<InterviewAnswers>(EMPTY_ANSWERS);
  const [status, setStatus] = useState<"idle" | "generating" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const isLastStep = step === STEP_COUNT - 1;
  const canAdvance = stepIsValid(step, answers);

  function goNext() {
    if (isLastStep) {
      void handleGenerate();
      return;
    }
    setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleGenerate() {
    setStatus("generating");
    setError(null);

    try {
      const payload: InterviewAnswers = {
        ...answers,
        example_posts: answers.example_posts.filter(
          (post) => post.trim().length > 0,
        ),
      };

      const response = await fetch("/api/brand-pack/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error ?? `Something went wrong (${response.status}).`,
        );
      }

      const pack = (await response.json()) as BrandPackRow;
      onComplete(pack);
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  if (status === "generating") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white px-8 py-24 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-50" />
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          Building your Brand Pack…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col rounded-xl border border-zinc-200 bg-white px-8 py-10 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto w-full max-w-xl">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="mb-6 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            ← Back to Brand Pack
          </button>
        ) : null}

        <div className="mb-6 flex items-center gap-1.5">
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                i <= step
                  ? "bg-zinc-900 dark:bg-zinc-50"
                  : "bg-zinc-200 dark:bg-zinc-800"
              }`}
            />
          ))}
        </div>

        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Step {step + 1} of {STEP_COUNT}
        </p>

        <StepFields
          step={step}
          answers={answers}
          onChange={setAnswers}
        />

        {status === "error" && error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              className="mt-2 font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : null}

        <div className="mt-8 flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            className="rounded-full px-5 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-0 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Back
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!canAdvance}
            className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {isLastStep ? "Generate Brand Pack" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

function stepIsValid(step: number, answers: InterviewAnswers): boolean {
  switch (step) {
    case 0:
      return answers.what_you_sell.trim().length > 0;
    case 1:
      return answers.who_its_for.trim().length > 0;
    case 2:
      return answers.desired_next_action.trim().length > 0;
    case 3:
      return answers.example_posts[0]?.trim().length > 0;
    case 4:
      return answers.never_say.trim().length > 0;
    default:
      return false;
  }
}

function StepFields({
  step,
  answers,
  onChange,
}: {
  step: number;
  answers: InterviewAnswers;
  onChange: (answers: InterviewAnswers) => void;
}) {
  const textareaClass =
    "mt-4 w-full resize-none rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  switch (step) {
    case 0:
      return (
        <div>
          <h1 className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            What do you sell?
          </h1>
          <textarea
            autoFocus
            rows={4}
            placeholder="e.g. A Chrome extension that turns support tickets into changelogs"
            value={answers.what_you_sell}
            onChange={(e) =>
              onChange({ ...answers, what_you_sell: e.target.value })
            }
            className={textareaClass}
          />
        </div>
      );
    case 1:
      return (
        <div>
          <h1 className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Who is it for?
          </h1>
          <textarea
            autoFocus
            rows={4}
            placeholder="e.g. Solo founders and small dev teams shipping their own support"
            value={answers.who_its_for}
            onChange={(e) =>
              onChange({ ...answers, who_its_for: e.target.value })
            }
            className={textareaClass}
          />
        </div>
      );
    case 2:
      return (
        <div>
          <h1 className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            What do you want someone to do after a good interaction?
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Reply, DM, visit a link — whatever the next step should be.
          </p>
          <textarea
            autoFocus
            rows={3}
            placeholder="e.g. Reply asking a follow-up question, or click through to the changelog"
            value={answers.desired_next_action}
            onChange={(e) =>
              onChange({ ...answers, desired_next_action: e.target.value })
            }
            className={textareaClass}
          />
        </div>
      );
    case 3:
      return (
        <div>
          <h1 className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Paste 1–2 example posts
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Real or representative posts in your niche — this teaches the
            model what good engagement looks like.
          </p>
          <textarea
            autoFocus
            rows={3}
            placeholder="Example post 1"
            value={answers.example_posts[0] ?? ""}
            onChange={(e) =>
              onChange({
                ...answers,
                example_posts: [e.target.value, answers.example_posts[1] ?? ""],
              })
            }
            className={textareaClass}
          />
          <textarea
            rows={3}
            placeholder="Example post 2 (optional)"
            value={answers.example_posts[1] ?? ""}
            onChange={(e) =>
              onChange({
                ...answers,
                example_posts: [answers.example_posts[0] ?? "", e.target.value],
              })
            }
            className={textareaClass}
          />
        </div>
      );
    case 4:
      return (
        <div>
          <h1 className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            What do you never say?
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Tone or topics to avoid — hype, politics, specific claims, etc.
          </p>
          <textarea
            autoFocus
            rows={4}
            placeholder="e.g. Never claim specific revenue numbers, never dunk on competitors"
            value={answers.never_say}
            onChange={(e) =>
              onChange({ ...answers, never_say: e.target.value })
            }
            className={textareaClass}
          />
        </div>
      );
    default:
      return null;
  }
}
