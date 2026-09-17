/** What an empty Channel list says (#136). Channels are created in Admin › Channels, which
 * nothing on an empty screen pointed to, so whoever may create one is offered the way there. */
export function ChannelsEmptyState({
  className,
  canCreate,
  onCreate,
}: Readonly<{ className: string; canCreate: boolean; onCreate: () => void }>) {
  return (
    <p className={className}>
      No Channels yet.
      {canCreate && (
        <>
          {" "}
          <button className="link link-inline" onClick={onCreate} data-testid="create-channel-link">
            Create one in Admin
          </button>
        </>
      )}
    </p>
  );
}
