import { useSyncExternalStore } from "react";
import type { UpdateNotice as Notice } from "../lib/appUpdate";
import { Icon } from "./icons/Icon";

/** "A new version is available" (#203) — above every screen, onboarding included, and never a
 * reload by itself: only the person's Reload, so a draft in a composer is theirs to keep. */
export function UpdateNotice({ notice }: Readonly<{ notice: Notice }>) {
  const available = useSyncExternalStore(notice.subscribe, notice.getSnapshot, notice.getSnapshot);
  if (!available) return null;
  return (
    <div className="update-notice" role="status" data-testid="update-notice">
      A new version of Studio is available.
      <button type="button" className="link link-inline" onClick={() => window.location.reload()}>
        Reload
      </button>
      <button type="button" className="btn btn-ghost btn-icon btn-xs" aria-label="Dismiss" onClick={notice.dismiss}>
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}
