"use client";

import { useState } from "react";

export function XConnectionForm({ initialHandle }: { initialHandle: string | null }) {
  const [authToken, setAuthToken] = useState("");
  const [ct0, setCt0] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [connectedHandle, setConnectedHandle] = useState<string | null>(initialHandle);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  async function handleDisconnect() {
    if (disconnecting) return;

    setDisconnecting(true);

    try {
      const response = await fetch("/api/settings/x-connection", {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Disconnect failed (${response.status}).`);
      }

      setConnectedHandle(null);
      setConfirmingDisconnect(false);
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Failed to disconnect that X account.",
      );
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSave() {
    if (status === "saving" || !authToken.trim() || !ct0.trim()) return;

    setStatus("saving");
    setError(null);

    try {
      const response = await fetch("/api/settings/x-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auth_token: authToken, ct0 }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.connected) {
        throw new Error(body?.error ?? `Connection failed (${response.status}).`);
      }

      setConnectedHandle(body.handle as string);
      setAuthToken("");
      setCt0("");
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Failed to connect that X account.",
      );
    }
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        X Account
      </h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Connect an X account so Launchpad can post a reply on your behalf,
        with a click, from a draft you choose.
      </p>

      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        These are unofficial X session cookies pulled from a logged-in
        browser session, not an official API key. X can rate-limit or
        restrict an account for using session cookies this way — understand
        that risk before pasting anything here.
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            auth_token
          </span>
          <input
            type="password"
            autoComplete="off"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder="Paste your X auth_token cookie"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            ct0
          </span>
          <input
            type="password"
            autoComplete="off"
            value={ct0}
            onChange={(e) => setCt0(e.target.value)}
            placeholder="Paste your X ct0 cookie"
            className={inputClass}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={status === "saving" || !authToken.trim() || !ct0.trim()}
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {status === "saving" ? "Connecting…" : "Save & Test Connection"}
        </button>

        {connectedHandle ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
              Connected as @{connectedHandle}
            </span>

            {confirmingDisconnect ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                <span>Disconnect this X account?</span>
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  disabled={disconnecting}
                  className="rounded-full bg-amber-800 px-3 py-1 font-medium text-white hover:bg-amber-900 disabled:opacity-50 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200"
                >
                  {disconnecting ? "Disconnecting…" : "Yes, disconnect"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDisconnect(false)}
                  className="rounded-full px-3 py-1 font-medium text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDisconnect(true)}
                className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Disconnect
              </button>
            )}
          </>
        ) : (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Not connected.
          </span>
        )}
      </div>

      {status === "error" && error ? (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
