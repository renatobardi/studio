/** The prototype's auxiliary-panel constants (docs/UI/design/Studio.dc.html). */
const PANE_DEFAULT_WIDTH_PX = 380;
const PANE_MIN_WIDTH_PX = 300;
const SINGLE_COLUMN_BREAKPOINT_PX = PANE_MIN_WIDTH_PX * 2;

export interface ChannelLayout {
  /** Under 600px: one column, a thread replacing the timeline, members floating over it. */
  narrow: boolean;
  /** The `grid-template-columns` of the Channel's grid. */
  columns: string;
  showTimeline: boolean;
  membersOverlay: boolean;
}

/**
 * How a Channel shares its measured width with a side pane (#72). A pane takes 380px, never
 * less than 300 and never so much that the timeline goes under 300. An unmeasured Channel
 * (0px, before the first layout) is treated as wide, as the prototype does.
 */
export function channelLayout(width: number, panes: { thread: boolean; members: boolean }): ChannelLayout {
  const narrow = width > 0 && width < SINGLE_COLUMN_BREAKPOINT_PX;
  const paneOpen = panes.thread || panes.members;
  const paneWidth =
    width > 0 ? Math.max(PANE_MIN_WIDTH_PX, Math.min(PANE_DEFAULT_WIDTH_PX, width - PANE_MIN_WIDTH_PX)) : PANE_DEFAULT_WIDTH_PX;
  return {
    narrow,
    columns: narrow || !paneOpen ? "minmax(0, 1fr)" : `minmax(0, 1fr) ${paneWidth}px`,
    showTimeline: !(narrow && panes.thread),
    membersOverlay: narrow,
  };
}
