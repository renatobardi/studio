import type { ReactNode } from "react";
import { Icon } from "../../components/icons/Icon";

/** The prototype's modal shell, shared by every dialog in the app: the dimmed backdrop that
 * closes on a click outside, the header with its close button, title and description, the body,
 * and the footer the caller fills. `name` is the prototype's dialog id — it names both the
 * title element the dialog is labelled by and the test id the flows look for. */
export function Dialog({
  name,
  title,
  description,
  footer,
  onClose,
  children,
}: Readonly<{
  name: string;
  title: ReactNode;
  description: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  children: ReactNode;
}>) {
  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${name}-title`}
        data-testid={`${name}-dialog`}
      >
        <div className="dialog-header">
          <button className="dialog-close" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="x" size={16} />
          </button>
          <h2 id={`${name}-title`} className="dialog-title">
            {title}
          </h2>
          <p className="dialog-description">{description}</p>
        </div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-footer">{footer}</div>
      </div>
    </div>
  );
}
