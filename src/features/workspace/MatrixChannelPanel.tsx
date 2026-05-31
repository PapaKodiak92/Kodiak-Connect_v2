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

function getMatrixErrorMessage(error: unknown) {
  if (error instanceof MatrixRestError) {
    if (error.errcode === 'M_NOT_FOUND' || error.status === 404) {
      return 'This Matrix room does not exist yet. Run the staging setup script for #general.';
    }

    if (error.errcode === 'M_FORBIDDEN' || error.status === 403) {
      return 'You do not have access to this Matrix room yet.';
    }

    return error.message;
  }

  return 'Kodiak Connect could not reach the Matrix room.';
}

export function MatrixChannelPanel({ activeChannel, activeSpace, identity }: MatrixChannelPanelProps) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MatrixTextMessage[]>([]);
  const [draftMessage, setDraftMessage] = useState('');
  const [statusText, setStatusText] = useState('Connecting to Matrix room...');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const pollingTimer = useRef<number | null>(null);

  const displayName = getDisplayName(identity.userId);

  const refreshMessages = useCallback(
    async (targetRoomId: string) => {
      const recentMessages = await loadRecentMessages(identity, targetRoomId);
      setMessages(recentMessages);
      setStatusText(recentMessages.length ? 'Live staging room connected.' : 'Room connected. No messages yet.');
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
      setStatusText('Joining Matrix room...');

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
        setErrorText(getMatrixErrorMessage(error));
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
  }, [activeChannel.matrixAlias, identity, refreshMessages]);

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

    if (!roomId || !trimmedMessage) {
      return;
    }

    setIsSending(true);
    setErrorText(null);

    try {
      await sendTextMessage(identity, roomId, trimmedMessage);
      setDraftMessage('');
      await refreshMessages(roomId);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to send Matrix message', error);
      setErrorText(getMatrixErrorMessage(error));
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
        <div className="matrix-chat-status">
          <span className={`status-light ${errorText ? 'status-light--offline' : 'status-light--online'}`} aria-hidden="true" />
          <span>{errorText ?? statusText}</span>
        </div>

        {isLoading ? (
          <div className="matrix-empty-state">Loading #general...</div>
        ) : messages.length ? (
          <div className="matrix-message-list" aria-label="Message history">
            {messages.map((message) => (
              <article key={message.eventId} className={`matrix-message ${message.sender === identity.userId ? 'matrix-message--own' : ''}`}>
                <header>
                  <strong>{getDisplayName(message.sender)}</strong>
                  <time>{formatMessageTime(message.originServerTs)}</time>
                </header>
                <p>{message.body}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="matrix-empty-state">No messages yet. Send the first message in Official Space.</div>
        )}
      </div>

      <form className="message-composer-placeholder" onSubmit={handleSendMessage}>
        <input
          type="text"
          placeholder={roomId ? `Message #${activeChannel.name}` : 'Room unavailable'}
          value={draftMessage}
          onChange={(event) => setDraftMessage(event.target.value)}
          disabled={!roomId || isSending}
        />
        <button type="submit" disabled={!roomId || isSending || !draftMessage.trim()}>
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </section>
  );
}
