import type { GapState } from "../../lib/feedGap";

/** What a reconnect could not bring in one answer (#254) — Messages, Replies, Reactions or
 * deletions, so the copy names none of them: said plainly above the history
 * rather than marked inside it — where a missing Direct Message falls is not known until it
 * arrives — and nothing already on screen is taken off it meanwhile. */
export function GapNotice({ gap, onRetry }: Readonly<{ gap: GapState; onRetry: () => void }>) {
  if (gap === "none") return null;
  return (
    <div className="gap-notice" role="status" data-testid="gap-notice">
      {gap === "filling" ? (
        "Catching up on what was sent while you were offline…"
      ) : (
        <>
          Some of what was sent while you were offline could not be loaded.
          <button type="button" className="link link-inline" onClick={onRetry}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}
