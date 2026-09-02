"use client";

import { useState } from "react";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";

type Props = {
  pack: BrandPackRow;
  onSaved: (pack: BrandPackRow) => void;
  onRedo: () => void;
};

export function BrandPackEditor({ pack, onSaved, onRedo }: Props) {
  const [positioning, setPositioning] = useState(pack.business_summary ?? "");
  const [icpBullets, setIcpBullets] = useState<string[]>(
    (pack.icp ?? "").split("\n").filter((line) => line.trim().length > 0),
  );
  const [voiceNotes, setVoiceNotes] = useState(pack.voice_notes ?? "");
  const [replyTemplates, setReplyTemplates] = useState<string[]>(
    pack.reply_templates ?? [],
  );
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingRedo, setConfirmingRedo] = useState(false);

  const inputClass =
    "w-full resize-none rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  async function handleSave() {
    setSaveStatus("saving");
    setSaveError(null);

    try {
      const response = await fetch("/api/brand-pack/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          positioning,
          icp_bullets: icpBullets.filter((b) => b.trim().length > 0),
          voice_notes: voiceNotes,
          reply_templates: replyTemplates,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${response.status}).`);
      }

      const saved = (await response.json()) as BrandPackRow;
      setSaveStatus("saved");
      onSaved(saved);
    } catch (err) {
      setSaveStatus("error");
      setSaveError(
        err instanceof Error ? err.message : "Failed to save. Please retry.",
      );
    }
  }

  function updateBullet(index: number, value: string) {
    setIcpBullets((bullets) =>
      bullets.map((b, i) => (i === index ? value : b)),
    );
  }

  function removeBullet(index: number) {
    setIcpBullets((bullets) => bullets.filter((_, i) => i !== index));
  }

  function updateTemplate(index: number, value: string) {
    setReplyTemplates((templates) =>
      templates.map((t, i) => (i === index ? value : t)),
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-8 rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Your Brand Pack
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Edit anything below, then save. This powers search, replies, and
            outreach everywhere else in Launchpad.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmingRedo(true)}
          className="shrink-0 rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Redo interview
        </button>
      </div>

      {confirmingRedo ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <p>
            Redoing the interview will replace your current Brand Pack once
            you finish the new one. Your existing pack stays untouched until
            then.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={onRedo}
              className="rounded-full bg-amber-800 px-4 py-2 text-xs font-medium text-white hover:bg-amber-900 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200"
            >
              Yes, redo interview
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRedo(false)}
              className="rounded-full px-4 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <section>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Positioning
        </h2>
        <textarea
          rows={3}
          value={positioning}
          onChange={(e) => setPositioning(e.target.value)}
          className={`mt-3 ${inputClass}`}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Ideal customer profile
        </h2>
        <div className="mt-3 flex flex-col gap-2">
          {icpBullets.map((bullet, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={bullet}
                onChange={(e) => updateBullet(i, e.target.value)}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => removeBullet(i)}
                aria-label="Remove bullet"
                className="shrink-0 rounded-full px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setIcpBullets((bullets) => [...bullets, ""])}
          className="mt-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          + Add bullet
        </button>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Voice notes
        </h2>
        <textarea
          rows={3}
          value={voiceNotes}
          onChange={(e) => setVoiceNotes(e.target.value)}
          className={`mt-3 ${inputClass}`}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Reply templates
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {replyTemplates.map((template, i) => (
            <textarea
              key={i}
              rows={2}
              value={template}
              onChange={(e) => updateTemplate(i, e.target.value)}
              className={inputClass}
            />
          ))}
        </div>
      </section>

      <div className="flex items-center gap-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saveStatus === "saving"}
          className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {saveStatus === "saving" ? "Saving…" : "Save"}
        </button>
        {saveStatus === "saved" ? (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Saved
          </span>
        ) : null}
        {saveStatus === "error" && saveError ? (
          <span className="text-sm text-red-600 dark:text-red-400">
            {saveError}
          </span>
        ) : null}
      </div>
    </div>
  );
}
