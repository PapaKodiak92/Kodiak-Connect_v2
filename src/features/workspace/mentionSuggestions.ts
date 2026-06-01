import type { MatrixTextMessage } from '../matrix/matrixRestClient';

export interface MentionSearch {
  query: string;
  startIndex: number;
}

export interface MentionSuggestion {
  displayName: string;
  localpart: string;
  userId: string;
}

const ACTIVE_MENTION_PATTERN = /(^|\s)@([a-zA-Z0-9._-]{0,32})$/;

export function getDisplayNameFromUserId(userId: string) {
  const withoutPrefix = userId.startsWith('@') ? userId.slice(1) : userId;
  return withoutPrefix.split(':')[0] || userId;
}

export function getUserLocalpart(userId: string) {
  return getDisplayNameFromUserId(userId).toLowerCase();
}

export function getActiveMentionSearch(draftMessage: string): MentionSearch | null {
  const match = draftMessage.match(ACTIVE_MENTION_PATTERN);

  if (!match) {
    return null;
  }

  return {
    query: match[2].toLowerCase(),
    startIndex: draftMessage.length - match[2].length - 1,
  };
}

export function getMentionSuggestions(messages: MatrixTextMessage[], currentUserLocalpart: string, search: MentionSearch | null) {
  if (!search) {
    return [];
  }

  const suggestionsByLocalpart = new Map<string, MentionSuggestion>();

  for (const message of messages) {
    const localpart = getUserLocalpart(message.sender);

    if (!localpart || localpart === currentUserLocalpart || suggestionsByLocalpart.has(localpart)) {
      continue;
    }

    suggestionsByLocalpart.set(localpart, {
      displayName: getDisplayNameFromUserId(message.sender),
      localpart,
      userId: message.sender,
    });
  }

  return [...suggestionsByLocalpart.values()]
    .filter((suggestion) => suggestion.localpart.includes(search.query))
    .slice(0, 6);
}

export function applyMentionSuggestion(draftMessage: string, search: MentionSearch | null, suggestion: MentionSuggestion) {
  if (!search) {
    return draftMessage;
  }

  return `${draftMessage.slice(0, search.startIndex)}@${suggestion.localpart} `;
}
