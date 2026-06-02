import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';
import { kodiakEnv } from '../../config/env';
import { officialSpace } from '../workspace/workspaceData';

interface KodiakAttachmentBridgeProps {
  identity: MatrixLoginIdentity;
}

interface MatrixUploadResponse {
  content_uri: string;
}

interface MatrixRoomMessageEvent {
  content?: {
    body?: string;
    info?: {
      mimetype?: string;
      size?: number;
    };
    msgtype?: string;
    url?: string;
  };
  event_id?: string;
  origin_server_ts?: number;
  sender?: string;
  type?: string;
}

interface MatrixMessagesResponse {
  chunk?: MatrixRoomMessageEvent[];
}

interface MatrixJoinResponse {
  room_id?: string;
}

interface MatrixCreateRoomResponse {
  room_id?: string;
}

interface MatrixDirectRoomsByUserId {
  [userId: string]: string[] | undefined;
}

interface SharedAttachment {
  body: string;
  eventId: string;
  mimetype: string;
  msgtype: string;
  objectUrl?: string;
  originServerTs: number;
  sender: string;
  size: number;
  url: string;
}

interface GiphySearchResult {
  id: string;
  title?: string;
  images?: {
    fixed_width?: {
      url?: string;
      width?: string;
      height?: string;
    };
    original?: {
      url?: string;
    };
  };
}

interface GiphySearchResponse {
  data?: GiphySearchResult[];
}

const MATRIX_SERVER_NAME = 'kodiak-connect.com';
const ATTACHMENT_POLL_INTERVAL_MS = 7000;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const IMAGE_MSGTYPES = new Set(['m.image']);
const AUDIO_MSGTYPES = new Set(['m.audio']);
const VIDEO_MSGTYPES = new Set(['m.video']);

function getAllOfficialChannels() {
  return officialSpace.sections.flatMap((section) => section.channels);
}

function getActiveChannelTitle() {
  return document.querySelector('.chat-placeholder__header h1')?.textContent?.trim() ?? '';
}

function getDmRoomCacheKey(currentUserId: string, targetUserId: string) {
  return `KC_DM_ROOM:${[currentUserId, targetUserId].sort().join('|')}`;
}

function getDisplayName(userId: string) {
  const withoutPrefix = userId.startsWith('@') ? userId.slice(1) : userId;
  return withoutPrefix.split(':')[0] || userId;
}

function formatBytes(bytes: number) {
  if (!bytes) {
    return 'Unknown size';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatTime(timestamp: number) {
  if (!timestamp) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function getAttachmentKind(file: File) {
  if (file.type.startsWith('image/')) return 'm.image';
  if (file.type.startsWith('audio/')) return 'm.audio';
  if (file.type.startsWith('video/')) return 'm.video';
  return 'm.file';
}

function getAttachmentLabel(msgtype: string) {
  if (msgtype === 'm.image') return 'image/GIF';
  if (msgtype === 'm.audio') return 'music/audio';
  if (msgtype === 'm.video') return 'video';
  return 'file';
}

function getSafeFileBody(file: File) {
  const maybeRelativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return maybeRelativePath || file.name || 'shared-file';
}

function getMxcParts(mxcUrl: string) {
  if (!mxcUrl.startsWith('mxc://')) {
    return null;
  }

  const [serverName, mediaId] = mxcUrl.slice('mxc://'.length).split('/');

  if (!serverName || !mediaId) {
    return null;
  }

  return { serverName, mediaId };
}

function getMatrixDownloadUrl(identity: MatrixLoginIdentity, mxcUrl: string) {
  const parts = getMxcParts(mxcUrl);

  if (!parts) {
    return mxcUrl;
  }

  return `${identity.baseUrl}/_matrix/client/v1/media/download/${encodeURIComponent(parts.serverName)}/${encodeURIComponent(parts.mediaId)}`;
}

async function readMatrixError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || 'Matrix request failed.';
  } catch {
    return 'Matrix request failed.';
  }
}

async function matrixJsonRequest<T>(identity: MatrixLoginIdentity, path: string, init: RequestInit = {}) {
  const response = await fetch(`${identity.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${identity.accessToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await readMatrixError(response));
  }

  return (await response.json()) as T;
}

async function joinRoomByAlias(identity: MatrixLoginIdentity, alias: string) {
  const response = await matrixJsonRequest<MatrixJoinResponse>(identity, `/_matrix/client/v3/join/${encodeURIComponent(alias)}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  if (!response.room_id) {
    throw new Error('Matrix did not return a room id.');
  }

  return response.room_id;
}

async function getDirectRoomId(identity: MatrixLoginIdentity, targetUserId: string) {
  const cacheKey = getDmRoomCacheKey(identity.userId, targetUserId);
  const cachedRoomId = window.localStorage.getItem(cacheKey);

  if (cachedRoomId) {
    return cachedRoomId;
  }

  let directRooms: MatrixDirectRoomsByUserId = {};

  try {
    directRooms = await matrixJsonRequest<MatrixDirectRoomsByUserId>(
      identity,
      `/_matrix/client/v3/user/${encodeURIComponent(identity.userId)}/account_data/m.direct`,
    );
  } catch {
    directRooms = {};
  }

  const existingRoomId = directRooms[targetUserId]?.[0];

  if (existingRoomId) {
    window.localStorage.setItem(cacheKey, existingRoomId);
    return existingRoomId;
  }

  const createdRoom = await matrixJsonRequest<MatrixCreateRoomResponse>(identity, '/_matrix/client/v3/createRoom', {
    method: 'POST',
    body: JSON.stringify({
      invite: [targetUserId],
      is_direct: true,
      name: getDisplayName(targetUserId),
      preset: 'trusted_private_chat',
      visibility: 'private',
    }),
  });

  if (!createdRoom.room_id) {
    throw new Error('Could not create direct message room.');
  }

  const nextDirectRooms = {
    ...directRooms,
    [targetUserId]: [createdRoom.room_id, ...(directRooms[targetUserId] ?? [])],
  };

  await matrixJsonRequest<Record<string, never>>(
    identity,
    `/_matrix/client/v3/user/${encodeURIComponent(identity.userId)}/account_data/m.direct`,
    {
      method: 'PUT',
      body: JSON.stringify(nextDirectRooms),
    },
  );

  window.localStorage.setItem(cacheKey, createdRoom.room_id);
  return createdRoom.room_id;
}

async function getActiveRoomId(identity: MatrixLoginIdentity) {
  const title = getActiveChannelTitle();

  if (!title) {
    throw new Error('Open a Matrix channel before sharing files.');
  }

  if (title.startsWith('#')) {
    const channelName = title.slice(1).trim();
    const channel = getAllOfficialChannels().find((candidate) => candidate.name === channelName && candidate.matrixAlias);

    if (!channel?.matrixAlias) {
      throw new Error('This channel is not connected to Matrix file sharing yet.');
    }

    return joinRoomByAlias(identity, channel.matrixAlias);
  }

  if (title.startsWith('@')) {
    const targetUserId = `@${title.slice(1).trim().split(':')[0]}:${MATRIX_SERVER_NAME}`;

    if (targetUserId === identity.userId) {
      throw new Error('Cannot share files to yourself here.');
    }

    return getDirectRoomId(identity, targetUserId);
  }

  throw new Error('This channel is not connected to Matrix file sharing yet.');
}

async function uploadFile(identity: MatrixLoginIdentity, file: File) {
  const uploadPaths = [
    `/_matrix/media/v3/upload?filename=${encodeURIComponent(getSafeFileBody(file))}`,
    `/_matrix/media/r0/upload?filename=${encodeURIComponent(getSafeFileBody(file))}`,
    `/_matrix/client/v1/media/upload?filename=${encodeURIComponent(getSafeFileBody(file))}`,
  ];

  let lastError = 'Matrix upload failed.';

  for (const path of uploadPaths) {
    const response = await fetch(`${identity.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${identity.accessToken}`,
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });

    if (response.ok) {
      const body = (await response.json()) as MatrixUploadResponse;
      return body.content_uri;
    }

    lastError = await readMatrixError(response);

    if (![400, 404, 405].includes(response.status)) {
      break;
    }
  }

  throw new Error(lastError);
}

async function sendAttachmentEvent(identity: MatrixLoginIdentity, roomId: string, file: File, contentUri: string) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const body = getSafeFileBody(file);
  const msgtype = getAttachmentKind(file);

  await matrixJsonRequest<{ event_id: string }>(
    identity,
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        body,
        filename: body,
        info: {
          mimetype: file.type || 'application/octet-stream',
          size: file.size,
        },
        msgtype,
        url: contentUri,
      }),
    },
  );
}

async function sendTextNotice(identity: MatrixLoginIdentity, roomId: string, body: string) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await matrixJsonRequest<{ event_id: string }>(
    identity,
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        body,
        msgtype: 'm.text',
      }),
    },
  );
}

async function loadRecentAttachments(identity: MatrixLoginIdentity, roomId: string) {
  const response = await matrixJsonRequest<MatrixMessagesResponse>(
    identity,
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=60`,
  );

  return (response.chunk ?? [])
    .filter((event) => {
      return (
        event.type === 'm.room.message' &&
        event.event_id &&
        event.sender &&
        event.content?.url &&
        ['m.image', 'm.audio', 'm.video', 'm.file'].includes(event.content.msgtype ?? '')
      );
    })
    .slice(0, 8)
    .map<SharedAttachment>((event) => ({
      body: event.content?.body || 'shared-file',
      eventId: event.event_id ?? '',
      mimetype: event.content?.info?.mimetype || 'application/octet-stream',
      msgtype: event.content?.msgtype || 'm.file',
      originServerTs: event.origin_server_ts ?? 0,
      sender: event.sender ?? 'unknown',
      size: event.content?.info?.size ?? 0,
      url: event.content?.url ?? '',
    }))
    .reverse();
}

async function getGifBlob(gifUrl: string) {
  const response = await fetch(gifUrl);

  if (!response.ok) {
    throw new Error('Could not load GIF from Giphy.');
  }

  return response.blob();
}

export function KodiakAttachmentBridge({ identity }: KodiakAttachmentBridgeProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const [attachments, setAttachments] = useState<SharedAttachment[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'files' | 'gifs' | 'recent'>('files');
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState<GiphySearchResult[]>([]);
  const [isSearchingGifs, setIsSearchingGifs] = useState(false);

  const clearPreviewUrls = useCallback(() => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  }, []);

  const refreshAttachments = useCallback(async () => {
    try {
      const roomId = await getActiveRoomId(identity);
      const loadedAttachments = await loadRecentAttachments(identity, roomId);

      clearPreviewUrls();

      const attachmentsWithObjects = await Promise.all(
        loadedAttachments.map(async (attachment) => {
          if (!IMAGE_MSGTYPES.has(attachment.msgtype) && !AUDIO_MSGTYPES.has(attachment.msgtype) && !VIDEO_MSGTYPES.has(attachment.msgtype)) {
            return attachment;
          }

          try {
            const response = await fetch(getMatrixDownloadUrl(identity, attachment.url), {
              headers: {
                Authorization: `Bearer ${identity.accessToken}`,
              },
            });

            if (!response.ok) {
              return attachment;
            }

            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            objectUrlsRef.current.push(objectUrl);
            return { ...attachment, objectUrl };
          } catch {
            return attachment;
          }
        }),
      );

      setAttachments(attachmentsWithObjects);
      setErrorText(null);
    } catch (error) {
      setAttachments([]);
      setErrorText(error instanceof Error ? error.message : 'Could not load shared files for this channel.');
    }
  }, [clearPreviewUrls, identity]);

  useEffect(() => {
    if (!isExpanded) {
      return undefined;
    }

    void refreshAttachments();
    const intervalId = window.setInterval(() => void refreshAttachments(), ATTACHMENT_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [isExpanded, refreshAttachments]);

  useEffect(() => {
    const input = folderInputRef.current;

    if (input) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }
  }, []);

  useEffect(() => clearPreviewUrls, [clearPreviewUrls]);

  useEffect(() => {
    if (!isExpanded || activeTab !== 'gifs' || !kodiakEnv.giphyApiKey) {
      return undefined;
    }

    const query = gifQuery.trim() || 'hello';
    const timerId = window.setTimeout(async () => {
      setIsSearchingGifs(true);
      setErrorText(null);

      try {
        const endpoint = gifQuery.trim()
          ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(kodiakEnv.giphyApiKey ?? '')}&q=${encodeURIComponent(query)}&limit=12&rating=pg-13`
          : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(kodiakEnv.giphyApiKey ?? '')}&limit=12&rating=pg-13`;
        const response = await fetch(endpoint);

        if (!response.ok) {
          throw new Error('Giphy search failed.');
        }

        const body = (await response.json()) as GiphySearchResponse;
        setGifResults(body.data ?? []);
      } catch (error) {
        setGifResults([]);
        setErrorText(error instanceof Error ? error.message : 'Could not search GIFs.');
      } finally {
        setIsSearchingGifs(false);
      }
    }, 300);

    return () => window.clearTimeout(timerId);
  }, [activeTab, gifQuery, isExpanded]);

  async function shareFiles(fileList: FileList | null) {
    const files = [...(fileList ?? [])];

    if (!files.length) {
      return;
    }

    const tooLargeFile = files.find((file) => file.size > MAX_ATTACHMENT_BYTES);

    if (tooLargeFile) {
      setErrorText(`${tooLargeFile.name} is too large. Keep files under ${formatBytes(MAX_ATTACHMENT_BYTES)} for now.`);
      return;
    }

    setIsSharing(true);
    setErrorText(null);
    setStatusText(`Sharing ${files.length} file${files.length === 1 ? '' : 's'}...`);

    try {
      const roomId = await getActiveRoomId(identity);
      const uploadedLabels: string[] = [];

      for (const file of files) {
        const fileBody = getSafeFileBody(file);
        const msgtype = getAttachmentKind(file);
        setStatusText(`Uploading ${fileBody}...`);
        const contentUri = await uploadFile(identity, file);
        await sendAttachmentEvent(identity, roomId, file, contentUri);
        uploadedLabels.push(`${getAttachmentLabel(msgtype)}: ${fileBody}`);
      }

      const noticeBody = files.length === 1
        ? `📎 Shared ${uploadedLabels[0]}. Open Transfers to preview/download.`
        : `📁 Shared ${files.length} files. Open Transfers to preview/download.`;
      await sendTextNotice(identity, roomId, noticeBody);

      setStatusText(`Shared ${files.length} file${files.length === 1 ? '' : 's'} to chat.`);
      setActiveTab('recent');
      await refreshAttachments();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not share file.');
    } finally {
      setIsSharing(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  }

  async function shareGiphyResult(gif: GiphySearchResult) {
    const gifUrl = gif.images?.original?.url ?? gif.images?.fixed_width?.url;

    if (!gifUrl) {
      setErrorText('That GIF is missing a usable URL.');
      return;
    }

    setIsSharing(true);
    setErrorText(null);
    setStatusText('Sharing GIF...');

    try {
      const roomId = await getActiveRoomId(identity);
      const title = gif.title?.trim() || 'giphy-gif';

      try {
        const blob = await getGifBlob(gifUrl);
        const file = new File([blob], `${title.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '') || 'giphy'}.gif`, {
          type: 'image/gif',
        });
        const contentUri = await uploadFile(identity, file);
        await sendAttachmentEvent(identity, roomId, file, contentUri);
        await sendTextNotice(identity, roomId, `🎞️ Shared GIF: ${title}. Open Transfers to preview/download.`);
      } catch {
        await sendTextNotice(identity, roomId, `🎞️ ${title}: ${gifUrl}`);
      }

      setStatusText('GIF shared to chat.');
      setActiveTab('recent');
      await refreshAttachments();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not share GIF.');
    } finally {
      setIsSharing(false);
    }
  }

  async function downloadAttachment(attachment: SharedAttachment) {
    try {
      const response = await fetch(getMatrixDownloadUrl(identity, attachment.url), {
        headers: {
          Authorization: `Bearer ${identity.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(await readMatrixError(response));
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = attachment.body.split('/').at(-1) || attachment.body || 'kodiak-file';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not download file.');
    }
  }

  return (
    <aside className={`kodiak-attachment-bridge ${isExpanded ? 'kodiak-attachment-bridge--expanded' : ''}`} aria-label="File sharing">
      <input ref={imageInputRef} type="file" accept="image/*,.gif" multiple hidden onChange={(event) => void shareFiles(event.currentTarget.files)} />
      <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => void shareFiles(event.currentTarget.files)} />
      <input ref={folderInputRef} type="file" multiple hidden onChange={(event) => void shareFiles(event.currentTarget.files)} />

      <button
        type="button"
        className="kodiak-attachment-bridge__toggle"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        title="GIFs, files, music, and folder sharing"
      >
        {isExpanded ? '×' : '📎'}
      </button>

      {isExpanded ? (
        <div className="kodiak-attachment-bridge__panel">
          <header>
            <div>
              <p className="eyebrow eyebrow--ember">Composer Tools</p>
              <h2>Share to chat</h2>
            </div>
            <button type="button" onClick={() => void refreshAttachments()} disabled={isSharing}>Refresh</button>
          </header>

          <div className="kodiak-attachment-tabs" role="tablist" aria-label="Transfer tools">
            <button type="button" className={activeTab === 'files' ? 'is-active' : undefined} onClick={() => setActiveTab('files')}>Files</button>
            <button type="button" className={activeTab === 'gifs' ? 'is-active' : undefined} onClick={() => setActiveTab('gifs')}>Giphy</button>
            <button type="button" className={activeTab === 'recent' ? 'is-active' : undefined} onClick={() => setActiveTab('recent')}>Recent</button>
          </div>

          {activeTab === 'files' ? (
            <div className="kodiak-attachment-actions">
              <button type="button" onClick={() => imageInputRef.current?.click()} disabled={isSharing}>Image / GIF</button>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isSharing}>File / Music</button>
              <button type="button" onClick={() => folderInputRef.current?.click()} disabled={isSharing}>Folder</button>
            </div>
          ) : null}

          {activeTab === 'gifs' ? (
            <div className="kodiak-giphy-panel">
              {kodiakEnv.giphyApiKey ? (
                <>
                  <input
                    type="search"
                    value={gifQuery}
                    onChange={(event) => setGifQuery(event.target.value)}
                    placeholder="Search Giphy"
                  />
                  {isSearchingGifs ? <p className="kodiak-attachment-status">Searching Giphy...</p> : null}
                  <div className="kodiak-giphy-grid">
                    {gifResults.map((gif) => {
                      const previewUrl = gif.images?.fixed_width?.url;

                      if (!previewUrl) {
                        return null;
                      }

                      return (
                        <button key={gif.id} type="button" onClick={() => void shareGiphyResult(gif)} disabled={isSharing}>
                          <img src={previewUrl} alt={gif.title || 'Giphy result'} />
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="kodiak-attachment-error">Add VITE_GIPHY_API_KEY to enable Giphy search.</p>
              )}
            </div>
          ) : null}

          {statusText ? <p className="kodiak-attachment-status">{statusText}</p> : null}
          {errorText ? <p className="kodiak-attachment-error">{errorText}</p> : null}

          {activeTab === 'recent' ? (
            <div className="kodiak-attachment-list">
              {attachments.length ? (
                attachments.map((attachment) => (
                  <article className="kodiak-attachment-card" key={attachment.eventId}>
                    {attachment.objectUrl && IMAGE_MSGTYPES.has(attachment.msgtype) ? <img src={attachment.objectUrl} alt="" /> : null}
                    {attachment.objectUrl && AUDIO_MSGTYPES.has(attachment.msgtype) ? <audio controls src={attachment.objectUrl} /> : null}
                    {attachment.objectUrl && VIDEO_MSGTYPES.has(attachment.msgtype) ? <video controls src={attachment.objectUrl} /> : null}
                    <div>
                      <strong>{attachment.body}</strong>
                      <span>{getDisplayName(attachment.sender)} · {formatBytes(attachment.size)} · {formatTime(attachment.originServerTs)}</span>
                    </div>
                    <button type="button" onClick={() => void downloadAttachment(attachment)}>Download</button>
                  </article>
                ))
              ) : (
                <p className="kodiak-attachment-empty">No shared files in this channel yet.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
