import type { ReactNode } from "react";
import { clockTime } from "../../lib/messageRow";
import { Avatar } from "./Avatar";
import type { Profile } from "./useProfiles";

/** One row of a conversation as the prototype draws it: the avatar in the gutter, author and
 * time on a baseline, the body, then whatever the conversation adds under it (attachments,
 * reactions, the thread pill). A continuation keeps the gutter but repeats no header. */
export function MessageRow({
  author,
  profile,
  createdAt,
  content,
  continuation = false,
  avatarSize = 32,
  className = "",
  testId,
  children,
  actions,
}: Readonly<{
  author: string;
  profile: Profile | undefined;
  createdAt?: number;
  content: string;
  continuation?: boolean;
  avatarSize?: number;
  className?: string;
  testId?: string;
  children?: ReactNode;
  /** Hover actions, floated at the row's top right. */
  actions?: ReactNode;
}>) {
  return (
    <li className={`message${continuation ? " continuation" : ""}${className ? ` ${className}` : ""}`} data-row="true" data-testid={testId}>
      {continuation && avatarSize === 32 ? (
        <span className="message-gutter" />
      ) : (
        <Avatar profile={profile} name={author} size={avatarSize} />
      )}
      <div className="message-body">
        {!continuation && (
          <div className="message-header">
            <span className="message-author">{author}</span>
            {createdAt !== undefined && <span className="message-time">{clockTime(createdAt)}</span>}
          </div>
        )}
        {content && <div className="message-content">{content}</div>}
        {children}
      </div>
      {actions}
    </li>
  );
}
