import { Icon } from "../../components/icons/Icon";

/** The Channel header's Members pill (#143): the roster's size, or nothing while the kind 39002
 * projection has not arrived yet — a 0 would read as an empty Channel. Pressing it opens the
 * Members pane, so it carries the pressed state the flows and screen readers go by. */
export function MembersPill({
  pubkeys,
  open,
  onToggle,
}: Readonly<{ pubkeys: string[] | null; open: boolean; onToggle: () => void }>) {
  return (
    <button
      className={`btn btn-outline${open ? " active" : ""}`}
      aria-pressed={open}
      aria-label="Members"
      title="Channel members"
      onClick={onToggle}
    >
      <Icon name="user" />
      {pubkeys?.length}
    </button>
  );
}
