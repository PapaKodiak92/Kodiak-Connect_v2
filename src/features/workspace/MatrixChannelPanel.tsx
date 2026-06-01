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

function getShortMessagePreview(body: string) {
  const compactBody = body.replace(/\s+/g, ' ').trim();
  return compactBody.length > 96 ? `${compactBody.slice(0, 96)}...` : compactBody;
}

function buildReplyBody(replyTarget: MatrixTextMessage | null, body: string) {
  if (!replyTarget) {
    return body;
  }

  return `Replying to ${getDisplayName(replyTarget.sender)}: ${getShortMessagePreview(replyTarget.body)}\n\n${body}`;
}

export function MatrixChannelPanel({ activeChannel, activeSpace, identity }: MatrixChannelPanelProps) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MatrixTextMessage[]>([]);
  const [draftMessage, setDraftMessage] = useState('');
  const [replyTarget, setReplyTarget] = useState<MatrixTextMessage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
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
            {messages.map((message) => (
              <article key={message.eventId} className={`matrix-message ${message.sender === identity.userId ? 'matrix-message--own' : ''}`}>
                <header>
                  <strong>{getDisplayName(message.sender)}</strong>
                  <time>{formatMessageTime(message.originServerTs)}</time>
                </header>
                <p>{message.body}</p>
                {canPost ? (
                  <div className="matrix-message-actions">
                    <button type="button" onClick={() => setReplyTarget(message)}>
                      Reply
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
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
              <span>{getShortMessagePreview(replyTarget.body)}</span>
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
