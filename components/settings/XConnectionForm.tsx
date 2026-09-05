"use client";

import { useState } from "react";

export type XConnectionStatus = {
  handle: string | null;
  provider: "oauth2" | "cookie" | null;
};

export function XConnectionForm({
  initial,
  oauthConfigured,
  legacyAvailable,
  callbackHandle,
  callbackError,
}: {
  initial: XConnectionStatus;
  oauthConfigured: boolean;
  legacyAvailable: boolean;
  callbackHandle: string | null;
  callbackError: string | null;
}) {
  const [authToken, setAuthToken] = useState("");
  const [ct0, setCt0] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(callbackErrorMessage(callbackError));
  const [connection, setConnection] = useState<XConnectionStatus>(
    callbackHandle ? { handle: callbackHandle, provider: "oauth2" } : initial,
  );
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  // Sends the browser to X's consent screen. The server mints the PKCE
  // handshake and sets its cookie first, so this only ever forwards to the
  // URL it hands back — the client never builds an authorize URL itself.
  async function handleConnectOfficial() {
    if (redirecting) return;

    setRedirecting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/x/start");
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.authorizeUrl) {
        throw new Error(body?.error ?? `Could not start X sign-in (${response.status}).`);
      }

      window.location.href = body.authorizeUrl as string;
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not start X sign-in.");
      setRedirecting(false);
    }
  }

  async function handleDisconnect() {
    if (disconnecting) return;

    setDisconnecting(true);

    try {
      const response = await fetch("/api/settings/x-connection", { method: "DELETE" });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Disconnect failed (${response.status}).`);
      }

      setConnection({ handle: null, provider: null });
      setConfirmingDisconnect(false);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to disconnect that X account.");
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSaveLegacy() {
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

      setConnection({ handle: body.handle as string, provider: "cookie" });
      setAuthToken("");
      setCt0("");
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to connect that X account.");
    }
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">X Account</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Connect an X account so HeatCheck can reply, like and follow on your
        behalf — with a click, from a draft you choose.
      </p>

      {connection.handle ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
            Connected as @{connection.handle}
          </span>
          <span
            className={
              connection.provider === "oauth2"
                ? "inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                : "inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            }
          >
            {connection.provider === "oauth2" ? "Official X API" : "Session cookies (legacy)"}
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
        </div>
      ) : null}

      {/* A cookie-connected account still posts through the unofficial
          path, which is the thing this migration exists to retire — so say
          so where the user can act on it, not in a changelog. */}
      {connection.handle && connection.provider === "cookie" && oauthConfigured ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <p>
            This account is still connected with session cookies. Reconnecting
            through X&apos;s official sign-in removes the risk of the account
            being restricted for posting this way, and HeatCheck stops holding
            your session cookies.
          </p>
          <button
            type="button"
            onClick={() => void handleConnectOfficial()}
            disabled={redirecting}
            className="mt-3 inline-flex items-center justify-center rounded-full bg-amber-800 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-900 disabled:opacity-50 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200"
          >
            {redirecting ? "Redirecting…" : "Reconnect with X"}
          </button>
        </div>
      ) : null}

      {!connection.handle ? (
        <div className="mt-4">
          {oauthConfigured ? (
            <>
              <button
                type="button"
                onClick={() => void handleConnectOfficial()}
                disabled={redirecting}
                className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {redirecting ? "Redirecting…" : "Connect X account"}
              </button>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                You&apos;ll approve HeatCheck on X, then land back here. No
                password or cookies are ever entered in HeatCheck.
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              X sign-in isn&apos;t configured on this server yet.
            </p>
          )}
        </div>
      ) : null}

      {legacyAvailable && !connection.handle ? (
        <details className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
            Connect with session cookies instead (legacy)
          </summary>

          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            These are unofficial X session cookies pulled from a logged-in
            browser session, not an official API key. X can rate-limit or
            restrict an account for posting this way — prefer the official
            connection above.
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

          <button
            type="button"
            onClick={() => void handleSaveLegacy()}
            disabled={status === "saving" || !authToken.trim() || !ct0.trim()}
            className="mt-4 inline-flex shrink-0 items-center justify-center rounded-full border border-zinc-300 px-6 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {status === "saving" ? "Connecting…" : "Save & Test Connection"}
          </button>
        </details>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

// The callback redirects with a short slug rather than the upstream error
// text, so the wording a user sees lives here.
function callbackErrorMessage(slug: string | null): string | null {
  switch (slug) {
    case null:
      return null;
    case "denied":
      return "You cancelled the X connection. Nothing was saved.";
    case "state_mismatch":
    case "invalid_callback":
      return "That X sign-in link expired or didn't match. Please try connecting again.";
    case "exchange_failed":
      return "X rejected the connection attempt. Please try again.";
    default:
      return "Could not connect that X account. Please try again.";
  }
}
