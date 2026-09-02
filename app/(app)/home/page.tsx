export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white px-8 py-24 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Tell the product what you sell
      </h1>
      <p className="mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
        A short interview builds your Brand Pack, which powers everything
        else in Launchpad — from what we search for to how replies sound.
      </p>
      <button
        type="button"
        disabled
        className="mt-6 inline-flex items-center justify-center rounded-full bg-zinc-200 px-6 py-2.5 text-sm font-medium text-zinc-500 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-500"
      >
        Start Brand Pack interview — coming soon
      </button>
    </div>
  );
}
