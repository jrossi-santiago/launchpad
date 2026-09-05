"use client";

import { useState } from "react";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import { InterviewWizard } from "@/components/brand-pack/InterviewWizard";
import { BrandPackEditor } from "@/components/brand-pack/BrandPackEditor";

export function BrandPackHome({
  initialBrandPack,
}: {
  initialBrandPack: BrandPackRow | null;
}) {
  const [pack, setPack] = useState<BrandPackRow | null>(initialBrandPack);
  const [showWizard, setShowWizard] = useState(false);

  if (showWizard) {
    return (
      <InterviewWizard
        onComplete={(newPack) => {
          setPack(newPack);
          setShowWizard(false);
        }}
        onCancel={pack ? () => setShowWizard(false) : undefined}
      />
    );
  }

  if (pack) {
    return (
      <BrandPackEditor
        pack={pack}
        onSaved={setPack}
        onRedo={() => setShowWizard(true)}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white px-8 py-24 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Tell the product what you sell
      </h1>
      <p className="mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
        A short interview builds your Brand Pack, which powers everything
        else in HeatCheck — from what we search for to how replies sound.
      </p>
      <button
        type="button"
        onClick={() => setShowWizard(true)}
        className="mt-6 inline-flex items-center justify-center rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Start Brand Pack interview
      </button>
    </div>
  );
}
