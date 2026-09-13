import { useRef, type ReactNode } from "react";
import { Icon } from "../../components/icons/Icon";
import { sendsOnKey } from "../../lib/composer";

const MAX_HEIGHT_PX = 160;

/**
 * The prototype's ChatInput (#70): a card with a growing textarea between the attach and
 * send buttons, Enter to send and Shift+Enter for a new line, the hint underneath. What a
 * send does — and what an attachment is — belongs to the Channel, Thread or Direct Message
 * around it; this only draws and dispatches.
 */
export function Composer({
  value,
  onChange,
  onSend,
  placeholder,
  canSend,
  disabled = false,
  sendLabel = "Send",
  onAttach,
  hint = true,
  testId,
  attachTestId,
  children,
  trailing,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  canSend: boolean;
  disabled?: boolean;
  /** The accessible name of the send button — "Retry" while a Direct Message is partly out. */
  sendLabel?: string;
  onAttach?: () => void;
  hint?: boolean;
  testId: string;
  attachTestId?: string;
  /** Rendered above the card: pending attachments, a send error. */
  children?: ReactNode;
  /** Rendered after the hint: limits, a Discard button. */
  trailing?: ReactNode;
}>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  };

  const send = () => {
    if (!canSend) return;
    onSend();
    // The textarea shrinks back once the draft is cleared; measure after React commits.
    requestAnimationFrame(resize);
  };

  return (
    <div className="composer-region" data-composer="true">
      {children}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {onAttach && (
          <button
            type="button"
            className="btn btn-ghost btn-icon composer-attach"
            data-testid={attachTestId}
            aria-label="Attach photos"
            title="Attach photos"
            disabled={disabled}
            onClick={onAttach}
          >
            <Icon name="paperclip" />
          </button>
        )}
        <textarea
          ref={textareaRef}
          className="composer-input"
          rows={1}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          data-testid={testId}
          onChange={(e) => {
            onChange(e.target.value);
            resize();
          }}
          onKeyDown={(e) => {
            if (sendsOnKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="submit"
          className={`btn btn-icon composer-send${canSend ? " btn-primary" : " btn-ghost"}`}
          aria-label={sendLabel}
          title={sendLabel}
          disabled={!canSend}
        >
          <Icon name="arrow-up" />
        </button>
      </form>
      <div className="composer-foot">
        {hint && <span className="composer-hint">Enter to send · Shift+Enter for new line</span>}
        {trailing}
      </div>
    </div>
  );
}
