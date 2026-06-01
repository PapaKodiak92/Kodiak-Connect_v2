import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';
import {
  joinRoomByAlias,
  loadRecentMessages,
  MatrixRestError,
  sendTextMessage,
  type MatrixTextMessage,
} from '../matrix/matrixRestClient';
import type { WorkspaceChannel, WorkspaceSpace } from './workspaceTypes';

interface MatrixChannelPanelProps {
  activeChannel: WorkspaceChannel;
  activeSpace: WorkspaceSpace;
  identity: MatrixLoginIdentity;
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

function getDisplayName(userId: string) {
  const withoutPrefix = userId.startsWith('@') ? userId.slice(1) : userId;
  return withoutPrefix.split(':')[0] || userId;
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

export function MatrixChannelPanel({ activeChannel, activeSpace, identity }: MatrixChannelPanelProps) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MatrixTextMessage[]>([]);
  const [draftMessage, setDraftMessage] = useState('');
  const [replyTarget, setReplyTarget] = useState<MatrixTextMessage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const messageElementRefs = useRef<Record<string, HTMLElement | null>>({});
  const pollingTimer = useRef<number | null>(null);

  const displayName = getDisplayName(identity.userId);
  const canPost = canPostInChannel(activeChannel, identity.userId);

  const refreshMessages = useCallback(
    async (targetRoomId: string) => {
      const recentMessages = await loadRecentMessages(identity, targetRoomId);
      setMessages(recentMessages);
    },
    [identity],
  );

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
    }, 5000);

    return () => {
      if (pollingTimer.current) {
        window.clearInterval(pollingTimer.current);
      }
    };
  }, [refreshMessages, roomId]);

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

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedMessage = draftMessage.trim();

    if (!roomId || !trimmedMessage || !canPost) {
      return;
    }

    setIsSending(true);
    setErrorText(null);

    try {
      await sendTextMessage(identity, roomId, buildReplyBody(replyTarget, trimmedMessage));
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
          <div className="matrix-message-list" aria-label="Message history">
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
                  >
                    <header>
                      <strong>{getDisplayName(message.sender)}</strong>
                      <time>{formatMessageTime(message.originServerTs)}</time>
                    </header>
                    <p>{parsedMessage.body}</p>
                    {canPost ? (
                      <div className="matrix-message-actions">
                        <button type="button" onClick={() => setReplyTarget({ ...message, body: parsedMessage.body })}>
                          Reply
                        </button>
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
        {replyTarget ? (
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

        <input
          type="text"
          placeholder={getComposerPlaceholder(activeChannel, canPost, roomId, replyTarget)}
          value={draftMessage}
          onChange={(event) => setDraftMessage(event.target.value)}
          disabled={!roomId || isSending || !canPost}
        />
        <button type="submit" disabled={!roomId || isSending || !canPost || !draftMessage.trim()}>
          {isSending ? 'Sending...' : activeChannel.readOnly ? 'Publish' : 'Send'}
        </button>
      </form>
    </section>
  );
}
