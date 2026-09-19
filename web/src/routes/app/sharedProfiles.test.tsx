import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChannelOut, WorkspaceOut } from "../../lib/api";
import { DEFAULT_APPEARANCE } from "../../lib/appearance";
import type { Signer } from "../../lib/custody";
import type { RelayClient } from "../../lib/relay";
import { AdminPane } from "./AdminPane";
import { ChannelView } from "./ChannelView";
import { MemberProfile } from "./MemberProfile";
import { MembersPane } from "./MembersPane";
import { ProfileScreen } from "./ProfileScreen";
import { ProfileSettings } from "./ProfileSettings";
import { SettingsView } from "./SettingsView";
import * as useProfilesModule from "./useProfiles";
import type { Profile, ProfileLookup } from "./useProfiles";

const ANA = "2".padEnd(64, "b");
const client = { subscribe: () => () => {} } as unknown as RelayClient;
const signer = {} as Signer;
const profileLookup: ProfileLookup = {
  profiles: new Map<string, Profile>([[ANA, { name: "Ana Petrova" }]]),
  ensure: () => {},
};

/** Each of these used to open a `ProfileStore` of its own — a second kind 0 REQ over nearly the
 * same authors as the shell's (#195). They read the shell's instead: nothing below it may call
 * `useProfiles`, and the names they show come from the lookup handed down. */
const panes: [string, () => ReactElement, string | null][] = [
  [
    "MembersPane",
    () => <MembersPane
      signer={signer}
      slug="family"
      channelId="c1"
      memberPubkeys={[ANA]}
      channelAdmins={[]}
      workspaceMembers={[]}
      canManage={false}
      profileLookup={profileLookup}
      onClose={() => {}}
    />,
    "Ana Petrova",
  ],
  ["MemberProfile", () => <MemberProfile profileLookup={profileLookup} pubkey={ANA} onClose={() => {}} />, "Ana Petrova"],
  [
    "ProfileScreen",
    () => <ProfileScreen
      client={client}
      signer={signer}
      pubkey={ANA}
      relayUrl="wss://relay.example"
      connectionState="open"
      profileLookup={profileLookup}
      onClose={() => {}}
    />,
    "Ana Petrova",
  ],
  [
    "ProfileSettings",
    () => <ProfileSettings pubkey={ANA} user={null} profileLookup={profileLookup} onSignOut={() => {}} />,
    "Ana Petrova",
  ],
  [
    "AdminPane",
    () => <AdminPane
      client={client}
      signer={signer}
      slug="family"
      workspaceRole="owner"
      initialTab="members"
      profileLookup={profileLookup}
    />,
    null,
  ],
  [
    "AdminPane › Channels",
    () => (
      <AdminPane client={client} signer={signer} slug="family" workspaceRole="owner" initialTab="channels" profileLookup={profileLookup} />
    ),
    null,
  ],
  [
    "SettingsView › Profile",
    () => (
      <SettingsView
        initialSection="profile"
        profileLookup={profileLookup}
        pubkey={ANA}
        user={null}
        appearance={DEFAULT_APPEARANCE}
        onAppearanceChange={() => {}}
        onSignOut={() => {}}
        onClose={() => {}}
      />
    ),
    "Ana Petrova",
  ],
  [
    "ChannelView",
    () => <ChannelView
      client={client}
      channel={{ id: "c1", name: "general", private: false } as ChannelOut}
      ownPubkey={ANA}
      signer={signer}
      opened={null}
      workspace={{ slug: "family", role: "member", media_url: "https://media.example" } as WorkspaceOut}
      workspaceMembers={[]}
      threadView="split"
      profileLookup={profileLookup}
    />,
    null,
  ],
];

describe("one ProfileStore, the shell's (#195)", () => {
  let spy: ReturnType<typeof spyOn> | null = null;
  afterEach(() => spy?.mockRestore());

  for (const [name, render, shownName] of panes) {
    test(`${name} reads the shell's profiles instead of opening its own subscription`, () => {
      spy = spyOn(useProfilesModule, "useProfiles");
      const html = renderToStaticMarkup(render());
      expect(spy).not.toHaveBeenCalled();
      if (shownName !== null) expect(html).toContain(shownName);
    });
  }
});
