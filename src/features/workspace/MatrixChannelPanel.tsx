import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';
import {
  joinRoomByAlias,
  loadRecentMessages,
  loadTypingUsers,
  MatrixRestError,
  redactMessage,
  sendReaction,
  sendReplacementMessage,
  sendTextMessage,
  sendTypingState,
  type MatrixTextMessage,
} from '../matrix/matrixRestClient';
import type { WorkspaceChannel, WorkspaceSpace } from './workspaceTypes';

interface MatrixChannelPanelProps {
  activeChannel: WorkspaceChannel;
  activeSpace: WorkspaceSpace;
  identity: MatrixLoginIdentity;
}

interface MentionSearch {
  query: string;
  startIndex: number;
}

interface MentionSuggestion {
  displayName: string;
  localpart: string;
  userId: string;
}

interface ParsedReplyContext {
  eventId?: string;
  preview: string;
  sender: string;
}

interface ParsedMessageBody {
  body: string;
  reply?: ParsedReplyContext;
}

const REPLY_EVENT_PREFIX = 'KC_REPLY_EVENT=';
const REPLY_SENDER_PREFIX = 'KC_REPLY_SENDER=';
const REPLY_PREVIEW_PREFIX = 'KC_REPLY_PREVIEW=';
const MENTION_PATTERN = /(^|\s)(@[a-zA-Z0-9._-]{2,32})/g;
const ACTIVE_MENTION_PATTERN = /(^|\s)@([a-zA-Z0-9._-]{0,32})$/;
const REACTION_OPTIONS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F525}', '\u{1F440}'];
const PLATFORM_MODERATOR_IDS = ['@papakodiak:v2.kodiak-connect.com'];
const MESSAGE_POLL_INTERVAL_MS = 5000;
const TYPING_POLL_INTERVAL_MS = 2500;
const TYPING_TIMEOUT_MS = 5000;
const TYPING_IDLE_STOP_MS = 2500;

function getDisplayName(userId: string) {
  const withoutPrefix = userId.startsWith('@') ? userId.slice(1) : userId;
  return withoutPrefix.split(':')[0] || userId;
}

function getUserLocalpart(userId: string) {
  return getDisplayName(userId).toLowerCase();
}

function formatMessageTime(timestamp: number) {
  if (!timestamp) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function getMatrixErrorMessage(error: unknown, activeChannel: WorkspaceChannel) {
  if (error instanceof MatrixRestError) {
    if (error.errcode === 'M_NOT_FOUND' || error.status === 404) {
      return `This Matrix room does not exist yet. Create #${activeChannel.name} on staging.`;
    }

    if (error.errcode === 'M_FORBIDDEN' || error.status === 403) {
      return 'You do not have access to this Matrix room yet.';
    }

    return error.message;
  }

  return 'Kodiak Connect could not reach the Matrix room.';
}

function canModerateMessages(userId: string) {
  return PLATFORM_MODERATOR_IDS.includes(userId);
}

function canPostInChannel(channel: WorkspaceChannel, userId: string) {
  if (!channel.readOnly) {
    return true;
  }

  return channel.allowedPosterIds?.includes(userId) ?? false;
}

function getComposerPlaceholder(channel: WorkspaceChannel, canPost: boolean, roomId: string | null, replyTarget: MatrixTextMessage | null) {
  if (!roomId) {
    return 'Room unavailable';
  }

  if (!canPost) {
    return 'Read-only official channel';
  }

  if (replyTarget) {
    return `Reply to ${getDisplayName(replyTarget.sender)}`;
  }

  if (channel.readOnly) {
    return `Post official update in #${channel.name}`;
  }

  return `Message #${channel.name}`;
}

function getEmptyState(channel: WorkspaceChannel, canPost: boolean) {
  if (channel.id === 'dev-updates') {
    return canPost
      ? 'No development updates yet. Post the first curated changelog when ready.'
      : 'No development updates yet. Official Kodiak updates will appear here.';
  }

  if (channel.id === 'announcements') {
    return canPost ? 'No announcements yet. Publish the first official announcement when ready.' : 'No announcements yet.';
  }

  return 'No messages yet. Send the first message in Official Space.';
}

function getShortMessagePreview(body: string, maxLength = 52) {
  const compactBody = body.replace(/\s+/g, ' ').trim();
  return compactBody.length > maxLength ? `${compactBody.slice(0, maxLength).trim()}...` : compactBody;
}

function parseKeyedReplyBody(body: string): ParsedMessageBody | null {
  if (!body.startsWith(REPLY_EVENT_PREFIX)) {
    return null;
  }

  const [metadataBlock, ...bodyParts] = body.split('\n\n');
  const metadataLines = metadataBlock.split('\n');
  const eventId = metadataLines.find((line) => line.startsWith(REPLY_EVENT_PREFIX))?.slice(REPLY_EVENT_PREFIX.length);
  const sender = metadataLines.find((line) => line.startsWith(REPLY_SENDER_PREFIX))?.slice(REPLY_SENDER_PREFIX.length);
  const preview = metadataLines.find((line) => line.startsWith(REPLY_PREVIEW_PREFIX))?.slice(REPLY_PREVIEW_PREFIX.length);
  const messageBody = bodyParts.join('\n\n').trim();

  if (!sender || !preview || !messageBody) {
    return null;
  }

  return {
    body: messageBody,
    reply: {
      eventId,
      preview: getShortMessagePreview(preview, 52),
      sender,
    },
  };
}

function parseLegacyReplyBody(body: string): ParsedMessageBody | null {
  const match = body.match(/^Replying to ([^:]+): ([\s\S]+?)\n\n([\s\S]+)$/);

  if (!match) {
    return null;
  }

  return {
    body: match[3].trim(),
    reply: {
      preview: getShortMessagePreview(match[2], 52),
      sender: match[1],
    },
  };
}

function parseMessageBody(body: string): ParsedMessageBody {
  return parseKeyedReplyBody(body) ?? parseLegacyReplyBody(body) ?? { body };
}

function buildReplyBody(replyTarget: MatrixTextMessage | null, body: string) {
  if (!replyTarget) {
    return body;
  }

  const parsedTarget = parseMessageBody(replyTarget.body);

  return [
    `${REPLY_EVENT_PREFIX}${replyTarget.eventId}`,
    `${REPLY_SENDER_PREFIX}${getDisplayName(replyTarget.sender)}`,
    `${REPLY_PREVIEW_PREFIX}${getShortMessagePreview(parsedTarget.body, 52)}`,
    '',
    body,
  ].join('\n');
}

function getActiveMentionSearch(draftMessage: string): MentionSearch | null {
  const match = draftMessage.match(ACTIVE_MENTION_PATTERN);

  if (!match) {
    return null;
  }

  return {
    query: match[2].toLowerCase(),
    startIndex: draftMessage.length - match[2].length - 1,
  };
}

function getMentionSuggestions(messages: MatrixTextMessage[], currentUserLocalpart: string, search: MentionSearch | null) {
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
      displayName: getDisplayName(message.sender),
      localpart,
      userId: message.sender,
    });
  }

  return [...suggestionsByLocalpart.values()]
    .filter((suggestion) => suggestion.localpart.includes(search.query))
    .slice(0, 6);
}

function applyMentionSuggestion(draftMessage: string, search: MentionSearch | null, suggestion: MentionSuggestion) {
  if (!search) {
    return draftMessage;
  }

  return `${draftMessage.slice(0, search.startIndex)}@${suggestion.localpart} `;
}

function hasUserReacted(message: MatrixTextMessage, reactionKey: string, userId: string) {
  return message.reactions?.some((reaction) => reaction.key === reactionKey && reaction.senders.includes(userId)) ?? false;
}

function getTypingIndicatorText(typingUserIds: string[]) {
  const typingNames = typingUserIds.map(getDisplayName);

  if (typingNames.length === 0) {
    return '';
  }

  if (typingNames.length === 1) {
    return `${typingNames[0]} is typing`;
  }

  if (typingNames.length === 2) {
    return `${typingNames[0]} and ${typingNames[1]} are typing`;
  }

  return `${typingNames[0]} and ${typingNames.length - 1} others are typing`;
}

function renderMessageTextWithMentions(body: string, currentUserLocalpart: string): ReactNode[] {
  const renderedParts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  MENTION_PATTERN.lastIndex = 0;

  while ((match = MENTION_PATTERN.exec(body)) !== null) {
    const fullMatch = match[0];
    const leadingWhitespace = match[1] ?? '';
    const mention = match[2];
    const mentionStart = match.index + leadingWhitespace.length;

    if (mentionStart > lastIndex) {
      renderedParts.push(body.slice(lastIndex, mentionStart));
    }

    const mentionLocalpart = mention.slice(1).toLowerCase();
    const isMentioningCurrentUser = mentionLocalpart === currentUserLocalpart;

    renderedParts.push(
      <span key={`${mention}-${mentionStart}`} className={`matrix-mention ${isMentioningCurrentUser ? 'matrix-mention--self' : ''}`}>
        {mention}
      </span>,
    );

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < body.length) {
    renderedParts.push(body.slice(lastIndex));
  }

  return renderedParts;
}

export function MatrixChannelPanel({ activeChannel, activeSpace, identity }: MatrixChannelPanelProps) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MatrixTextMessage[]>([]);
  const [draftMessage, setDraftMessage] = useState('');
  const [replyTarget, setReplyTarget] = useState<MatrixTextMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<MatrixTextMessage | null>(null);
  const [openActionMenu, setOpenActionMenu] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<MatrixTextMessage | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const messageElementRefs = useRef<Record<string, HTMLElement | null>>({});
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const pollingTimer = useRef<number | null>(null);
  const typingPollTimer = useRef<number | null>(null);
  const typingStopTimer = useRef<number | null>(null);
  const typingSinceBatchRef = useRef<string | undefined>(undefined);
  const isTypingSentRef = useRef(false);

  const displayName = getDisplayName(identity.userId);
  const currentUserLocalpart = getUserLocalpart(identity.userId);
  const activeMentionSearch = getActiveMentionSearch(draftMessage);
  const mentionSuggestions = getMentionSuggestions(messages, currentUserLocalpart, activeMentionSearch);
  const canPost = canPostInChannel(activeChannel, identity.userId);
  const canModerate = canModerateMessages(identity.userId);
  const openActionMenuMessage = openActionMenu ? messages.find((message) => message.eventId === openActionMenu.messageId) ?? null : null;
  const openActionMenuParsedMessage = openActionMenuMessage ? parseMessageBody(openActionMenuMessage.body) : null;
  const typingIndicatorText = getTypingIndicatorText(typingUserIds);

  const refreshMessages = useCallback(
    async (targetRoomId: string) => {
      const recentMessages = await loadRecentMessages(identity, targetRoomId);
      setMessages(recentMessages);
    },
    [identity],
  );

  const stopTyping = useCallback(async () => {
    if (!roomId || !isTypingSentRef.current) {
      return;
    }

    isTypingSentRef.current = false;

    try {
      await sendTypingState(identity, roomId, false);
    } catch (error) {
      console.warn('[Kodiak Connect] Failed to stop Matrix typing notification', error);
    }
  }, [identity, roomId]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
  }, [activeChannel.id]);

  useEffect(() => {
    let isActive = true;

    async function connectRoom() {
      if (!activeChannel.matrixAlias) {
        setIsLoading(false);
        setRoomId(null);
        setErrorText('This channel is not connected to Matrix yet.');
        return;
      }

      setIsLoading(true);
      setErrorText(null);
      setReplyTarget(null);
      setEditingMessage(null);
      setOpenActionMenu(null);
      setPendingDeleteMessage(null);
      setTypingUserIds([]);
      typingSinceBatchRef.current = undefined;
      isTypingSentRef.current = false;

      try {
        const joinedRoomId = await joinRoomByAlias(identity, activeChannel.matrixAlias);

        if (!isActive) {
          return;
        }

        setRoomId(joinedRoomId);
        await refreshMessages(joinedRoomId);
      } catch (error) {
        if (!isActive) {
          return;
        }

        console.error('[Kodiak Connect] Failed to connect Matrix room', error);
        setRoomId(null);
        setMessages([]);
        setErrorText(getMatrixErrorMessage(error, activeChannel));
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void connectRoom();

    return () => {
      isActive = false;
    };
  }, [activeChannel, activeChannel.matrixAlias, identity, refreshMessages]);

  useEffect(() => {
    if (!roomId) {
      return undefined;
    }

    pollingTimer.current = window.setInterval(() => {
      void refreshMessages(roomId).catch((error) => {
        console.error('[Kodiak Connect] Matrix room refresh failed', error);
      });
    }, MESSAGE_POLL_INTERVAL_MS);

    return () => {
      if (pollingTimer.current) {
        window.clearInterval(pollingTimer.current);
      }
    };
  }, [refreshMessages, roomId]);

  useEffect(() => {
    if (!roomId) {
      return undefined;
    }

    async function refreshTypingUsers() {
      if (!roomId) {
        return;
      }

      try {
        const typingState = await loadTypingUsers(identity, roomId, typingSinceBatchRef.current);
        typingSinceBatchRef.current = typingState.nextBatch ?? typingSinceBatchRef.current;

        if (typingState.userIds) {
          setTypingUserIds(typingState.userIds.filter((userId) => userId !== identity.userId));
        }
      } catch (error) {
        console.warn('[Kodiak Connect] Matrix typing poll failed', error);
      }
    }

    void refreshTypingUsers();

    typingPollTimer.current = window.setInterval(() => {
      void refreshTypingUsers();
    }, TYPING_POLL_INTERVAL_MS);

    return () => {
      if (typingPollTimer.current) {
        window.clearInterval(typingPollTimer.current);
      }
    };
  }, [identity, roomId]);

  useEffect(() => {
    if (!roomId || !canPost) {
      return undefined;
    }

    if (typingStopTimer.current) {
      window.clearTimeout(typingStopTimer.current);
      typingStopTimer.current = null;
    }

    if (!draftMessage.trim()) {
      void stopTyping();
      return undefined;
    }

    if (!isTypingSentRef.current) {
      isTypingSentRef.current = true;
      void sendTypingState(identity, roomId, true, TYPING_TIMEOUT_MS).catch((error) => {
        isTypingSentRef.current = false;
        console.warn('[Kodiak Connect] Failed to send Matrix typing notification', error);
      });
    }

    typingStopTimer.current = window.setTimeout(() => {
      void stopTyping();
    }, TYPING_IDLE_STOP_MS);

    return () => {
      if (typingStopTimer.current) {
        window.clearTimeout(typingStopTimer.current);
      }
    };
  }, [canPost, draftMessage, identity, roomId, stopTyping]);

  useEffect(() => {
    return () => {
      void stopTyping();
    };
  }, [stopTyping]);

  useEffect(() => {
    const messageList = messageListRef.current;

    if (!messageList || !shouldStickToBottomRef.current) {
      return;
    }

    messageList.scrollTop = messageList.scrollHeight;
  }, [messages, activeChannel.id]);

  function findMessageForDomTarget(target: EventTarget | null) {
    const element = target instanceof HTMLElement ? target : null;
    const messageElement = element?.closest<HTMLElement>('[data-message-event-id]');
    const eventId = messageElement?.dataset.messageEventId;

    if (!eventId) {
      return null;
    }

    return messages.find((message) => message.eventId === eventId) ?? null;
  }

  function handleMessageListContextMenu(event: MouseEvent<HTMLDivElement>) {
    const message = findMessageForDomTarget(event.target);

    if (!message) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openMessageActionMenu(message, event.clientX, event.clientY);
  }

  function handleMessageListScroll() {
    const messageList = messageListRef.current;

    if (!messageList) {
      return;
    }

    const distanceFromBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 160;
  }

  function handleJumpToMessage(eventId?: string) {
    if (!eventId) {
      return;
    }

    const targetElement = messageElementRefs.current[eventId];

    if (!targetElement) {
      return;
    }

    targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
    targetElement.classList.add('matrix-message--focused');

    window.setTimeout(() => {
      targetElement.classList.remove('matrix-message--focused');
    }, 1600);
  }

  function insertMentionSuggestion(suggestion: MentionSuggestion) {
    setDraftMessage((currentDraft) => applyMentionSuggestion(currentDraft, getActiveMentionSearch(currentDraft), suggestion));
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Tab' || mentionSuggestions.length === 0) {
      return;
    }

    event.preventDefault();
    insertMentionSuggestion(mentionSuggestions[0]);
  }

  function getSafeMenuPosition(clientX: number, clientY: number) {
    const menuWidth = 170;
    const menuHeight = 210;
    const padding = 14;

    return {
      x: Math.min(Math.max(clientX, padding), window.innerWidth - menuWidth - padding),
      y: Math.min(Math.max(clientY, padding), window.innerHeight - menuHeight - padding),
    };
  }

  function closeMessageActionMenu() {
    setOpenActionMenu(null);
  }

  function openMessageActionMenu(message: MatrixTextMessage, clientX: number, clientY: number) {
    if (!canPost) {
      return;
    }

    const position = getSafeMenuPosition(clientX, clientY);

    setOpenActionMenu({
      messageId: message.eventId,
      x: position.x,
      y: position.y,
    });

    setReactionPickerMessageId(null);
  }

  function startEditingMessage(message: MatrixTextMessage) {
    const parsedMessage = parseMessageBody(message.body);

    setEditingMessage({ ...message, body: parsedMessage.body });
    setReplyTarget(null);
    setReactionPickerMessageId(null);
    setOpenActionMenu(null);
    setDraftMessage(parsedMessage.body);
  }

  function cancelEditingMessage() {
    setEditingMessage(null);
    setDraftMessage('');
  }

  function requestDeleteMessage(message: MatrixTextMessage) {
    if (!roomId || (!canModerate && message.sender !== identity.userId)) {
      return;
    }

    setPendingDeleteMessage(message);
    setOpenActionMenu(null);
    setReactionPickerMessageId(null);
  }

  function closeDeleteConfirmation() {
    setPendingDeleteMessage(null);
  }

  async function confirmDeleteMessage() {
    const message = pendingDeleteMessage;

    if (!roomId || !message || (!canModerate && message.sender !== identity.userId)) {
      return;
    }

    setErrorText(null);

    try {
      await redactMessage(
        identity,
        roomId,
        message.eventId,
        message.sender === identity.userId ? 'User deleted message' : 'Moderator deleted message',
      );
      setPendingDeleteMessage(null);
      setReactionPickerMessageId(null);
      setOpenActionMenu(null);
      await refreshMessages(roomId);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to delete Matrix message', error);
      setErrorText(getMatrixErrorMessage(error, activeChannel));
    }
  }

  async function handleReactToMessage(message: MatrixTextMessage, reactionKey: string) {
    if (!roomId || !canPost || hasUserReacted(message, reactionKey, identity.userId)) {
      return;
    }

    setErrorText(null);

    try {
      await sendReaction(identity, roomId, message.eventId, reactionKey);
      setReactionPickerMessageId(null);
      await refreshMessages(roomId);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to send Matrix reaction', error);
      setErrorText(getMatrixErrorMessage(error, activeChannel));
    }
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedMessage = draftMessage.trim();

    if (!roomId || !trimmedMessage || !canPost) {
      return;
    }

    setIsSending(true);
    setErrorText(null);

    try {
      await stopTyping();

      if (editingMessage) {
        await sendReplacementMessage(identity, roomId, editingMessage.eventId, trimmedMessage);
        setEditingMessage(null);
      } else {
        await sendTextMessage(identity, roomId, buildReplyBody(replyTarget, trimmedMessage));
      }

      setDraftMessage('');
      setReplyTarget(null);
      await refreshMessages(roomId);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to send Matrix message', error);
      setErrorText(getMatrixErrorMessage(error, activeChannel));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="chat-placeholder" aria-label={`${activeChannel.name} channel`}>
      <header className="chat-placeholder__header">
        <div>
          <p className="eyebrow eyebrow--ember">{activeSpace.name}</p>
          <h1>#{activeChannel.name}</h1>
          <p>{activeChannel.description}</p>
        </div>

        <div className="chat-placeholder__user">
          <span className="status-light status-light--online" aria-hidden="true" />
          <span>{displayName}</span>
        </div>
      </header>

      <div className="matrix-chat-body">
        {errorText ? (
          <div className="matrix-chat-status matrix-chat-status--error">
            <span className="status-light status-light--offline" aria-hidden="true" />
            <span>{errorText}</span>
          </div>
        ) : null}

        {isLoading ? (
          <div className="matrix-empty-state">Loading #{activeChannel.name}...</div>
        ) : messages.length ? (
          <div
            ref={messageListRef}
            className="matrix-message-list"
            aria-label="Message history"
            onContextMenuCapture={handleMessageListContextMenu}
            onScroll={handleMessageListScroll}
          >
            {messages.map((message) => {
              const parsedMessage = parseMessageBody(message.body);
              const isOwnMessage = message.sender === identity.userId;

              return (
                <div key={message.eventId} className={`matrix-message-group ${isOwnMessage ? 'matrix-message-group--own' : ''}`}>
                  {parsedMessage.reply ? (
                    <button
                      type="button"
                      className="matrix-reply-thread-link"
                      onClick={() => handleJumpToMessage(parsedMessage.reply?.eventId)}
                      disabled={!parsedMessage.reply.eventId}
                      title={`Replying to ${parsedMessage.reply.sender}: ${parsedMessage.reply.preview}`}
                    >
                      <span className="matrix-reply-thread-link__arrow" aria-hidden="true">↪</span>
                      <strong>{parsedMessage.reply.sender}</strong>
                      <span className="matrix-reply-thread-link__separator" aria-hidden="true">·</span>
                      <span className="matrix-reply-thread-link__preview">{parsedMessage.reply.preview}</span>
                    </button>
                  ) : null}

                  <article
                    ref={(element) => {
                      messageElementRefs.current[message.eventId] = element;
                    }}
                    className={`matrix-message ${isOwnMessage ? 'matrix-message--own' : ''}`}
                    data-message-event-id={message.eventId}
                  >
                    <header>
                      <strong>{getDisplayName(message.sender)}</strong>
                      <time>{formatMessageTime(message.originServerTs)}</time>
                    </header>
                    <p>{renderMessageTextWithMentions(parsedMessage.body, currentUserLocalpart)}</p>
                    {message.editedAt ? <span className="matrix-message__edited">edited</span> : null}

                    {message.reactions?.length ? (
                      <div className="matrix-reactions" aria-label="Message reactions">
                        {message.reactions.map((reaction) => (
                          <button
                            key={reaction.key}
                            type="button"
                            className={hasUserReacted(message, reaction.key, identity.userId) ? 'matrix-reaction--mine' : undefined}
                            onClick={() => void handleReactToMessage(message, reaction.key)}
                            title={reaction.senders.map(getDisplayName).join(', ')}
                          >
                            <span>{reaction.key}</span>
                            <strong>{reaction.count}</strong>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {reactionPickerMessageId === message.eventId ? (
                      <div className="matrix-reaction-picker" aria-label="Choose a reaction">
                        {REACTION_OPTIONS.map((reactionKey) => (
                          <button key={reactionKey} type="button" onClick={() => void handleReactToMessage(message, reactionKey)}>
                            {reactionKey}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </article>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="matrix-empty-state">{getEmptyState(activeChannel, canPost)}</div>
        )}
      </div>

      <form className="message-composer-placeholder" onSubmit={handleSendMessage}>
        {typingIndicatorText ? (
          <div className="matrix-typing-indicator" aria-live="polite">
            <span>{typingIndicatorText}</span>
            <i aria-hidden="true" />
            <i aria-hidden="true" />
            <i aria-hidden="true" />
          </div>
        ) : null}

        {editingMessage ? (
          <div className="message-edit-preview">
            <div>
              <strong>Editing message</strong>
              <span>Save your changes or cancel editing.</span>
            </div>
            <button type="button" onClick={cancelEditingMessage} aria-label="Cancel edit">
              Cancel
            </button>
          </div>
        ) : null}

        {!editingMessage && replyTarget ? (
          <div className="message-reply-preview">
            <div>
              <strong>Replying to {getDisplayName(replyTarget.sender)}</strong>
              <span>{getShortMessagePreview(parseMessageBody(replyTarget.body).body, 72)}</span>
            </div>
            <button type="button" onClick={() => setReplyTarget(null)} aria-label="Cancel reply">
              Cancel
            </button>
          </div>
        ) : null}

        {mentionSuggestions.length ? (
          <div className="message-mention-suggestions" role="listbox" aria-label="Mention suggestions">
            {mentionSuggestions.map((suggestion) => (
              <button key={suggestion.userId} type="button" onClick={() => insertMentionSuggestion(suggestion)}>
                <span>@{suggestion.localpart}</span>
                <small>{suggestion.displayName}</small>
              </button>
            ))}
          </div>
        ) : null}

        <input
          type="text"
          placeholder={editingMessage ? 'Edit message' : getComposerPlaceholder(activeChannel, canPost, roomId, replyTarget)}
          value={draftMessage}
          onChange={(event) => setDraftMessage(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          disabled={!roomId || isSending || !canPost}
        />
        <button type="submit" disabled={!roomId || isSending || !canPost || !draftMessage.trim()}>
          {isSending ? (editingMessage ? 'Saving...' : 'Sending...') : editingMessage ? 'Save' : activeChannel.readOnly ? 'Publish' : 'Send'}
        </button>
      </form>

      {openActionMenu && openActionMenuMessage && openActionMenuParsedMessage ? (
        <div
          className="matrix-message-action-menu matrix-message-action-menu--floating kodiak-global-message-action-menu"
          style={{ left: openActionMenu.x, top: openActionMenu.y }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            onClick={() => {
              setReactionPickerMessageId((currentMessageId) =>
                currentMessageId === openActionMenuMessage.eventId ? null : openActionMenuMessage.eventId,
              );
              setOpenActionMenu(null);
            }}
          >
            React
          </button>
          <button
            type="button"
            onClick={() => {
              setReplyTarget({ ...openActionMenuMessage, body: openActionMenuParsedMessage.body });
              setEditingMessage(null);
              setOpenActionMenu(null);
            }}
          >
            Reply
          </button>
          {openActionMenuMessage.sender === identity.userId ? (
            <button type="button" onClick={() => startEditingMessage({ ...openActionMenuMessage, body: openActionMenuParsedMessage.body })}>
              Edit
            </button>
          ) : null}
          {openActionMenuMessage.sender === identity.userId || canModerate ? (
            <button type="button" className="matrix-message-action--danger" onClick={() => requestDeleteMessage(openActionMenuMessage)}>
              Delete
            </button>
          ) : null}
        </div>
      ) : null}

      {openActionMenu ? (
        <div
          className="matrix-action-menu-backdrop"
          aria-label="Close message actions"
          role="presentation"
          onClick={closeMessageActionMenu}
          onMouseDown={(event) => {
            if (event.button === 2) {
              event.preventDefault();
              event.stopPropagation();
              closeMessageActionMenu();
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMessageActionMenu();
          }}
        />
      ) : null}

      {pendingDeleteMessage ? (
        <div className="kodiak-modal-backdrop" role="presentation">
          <div className="kodiak-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-message-title">
            <div className="kodiak-confirm-modal__header">
              <p className="eyebrow eyebrow--ember">Message action</p>
              <h2 id="delete-message-title">Delete this message?</h2>
              <p>This removes the message from the room history. This action cannot be undone.</p>
            </div>

            <div className="kodiak-confirm-modal__preview">
              <strong>{getDisplayName(pendingDeleteMessage.sender)}</strong>
              <span>{getShortMessagePreview(parseMessageBody(pendingDeleteMessage.body).body, 120)}</span>
            </div>

            <div className="kodiak-confirm-modal__actions">
              <button type="button" onClick={closeDeleteConfirmation}>
                Cancel
              </button>
              <button type="button" className="kodiak-confirm-modal__danger" onClick={() => void confirmDeleteMessage()}>
                Delete message
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
