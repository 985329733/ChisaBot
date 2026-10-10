export type MessageListEmphasis = "agent" | "thread";

export type UserPreferences = {
  messageListEmphasis: MessageListEmphasis;
  /** Whether this person closed the banner offering help self-hosting OpenBot. */
  selfHostBannerDismissed: boolean;
  /** The Bot pinned at the top of the roster as this person's main Bot, or null for none. */
  mainBotId: string | null;
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  messageListEmphasis: "thread",
  selfHostBannerDismissed: false,
  mainBotId: null,
};
