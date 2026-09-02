export function ComingNext({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-8 py-24 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <span className="mb-3 inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
        Coming next
      </span>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
      </h1>
      <p className="mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
        {description}
      </p>
    </div>
  );
}
