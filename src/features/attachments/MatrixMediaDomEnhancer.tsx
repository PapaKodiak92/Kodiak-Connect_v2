import { useEffect } from 'react';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';

interface MatrixMediaDomEnhancerProps {
  identity: MatrixLoginIdentity;
}

interface EncodedMediaMessage {
  body?: string;
  info?: {
    mimetype?: string;
    size?: number;
  };
  msgtype?: string;
  url?: string;
}

const MEDIA_PREFIX = 'KC_MEDIA::';

function getMediaUrl(identity: MatrixLoginIdentity, mxcUrl?: string) {
  if (!mxcUrl) return null;
  if (!mxcUrl.startsWith('mxc://')) return mxcUrl;

  const [serverName, mediaId] = mxcUrl.slice('mxc://'.length).split('/');
  if (!serverName || !mediaId) return null;

  return `${identity.baseUrl}/_matrix/client/v1/media/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`;
}

function getFileName(body?: string) {
  return body?.split('/').at(-1)?.trim() || body?.trim() || 'Kodiak attachment';
}

function formatSize(size?: number) {
  if (!size) return 'Unknown size';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function buildCard(identity: MatrixLoginIdentity, media: EncodedMediaMessage) {
  const card = document.createElement('span');
  card.className = `matrix-media-message matrix-media-message--${media.msgtype?.replace('m.', '') || 'file'}`;
  const mediaUrl = getMediaUrl(identity, media.url);
  const fileName = getFileName(media.body);

  if (mediaUrl && media.msgtype === 'm.image') {
    const image = document.createElement('img');
    image.alt = fileName;
    image.src = mediaUrl;
    image.loading = 'lazy';
    card.append(image);
  }

  if (mediaUrl && media.msgtype === 'm.audio') {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = mediaUrl;
    card.append(audio);
  }

  if (mediaUrl && media.msgtype === 'm.video') {
    const video = document.createElement('video');
    video.controls = true;
    video.src = mediaUrl;
    card.append(video);
  }

  const details = document.createElement('span');
  details.className = 'matrix-media-message__details';
  details.innerHTML = `<strong>${fileName}</strong><small>${[media.info?.mimetype, formatSize(media.info?.size)].filter(Boolean).join(' - ')}</small>`;
  card.append(details);

  if (mediaUrl) {
    const link = document.createElement('a');
    link.className = 'matrix-media-message__open';
    link.href = mediaUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'Open';
    card.append(link);
  }

  return card;
}

function enhanceParagraph(identity: MatrixLoginIdentity, paragraph: HTMLParagraphElement) {
  if (paragraph.dataset.kodiakMediaEnhanced === 'true') return;

  const rawText = paragraph.textContent?.trim() ?? '';
  if (!rawText.startsWith(MEDIA_PREFIX)) return;

  paragraph.dataset.kodiakMediaEnhanced = 'true';

  try {
    const media = JSON.parse(rawText.slice(MEDIA_PREFIX.length)) as EncodedMediaMessage;
    paragraph.replaceChildren(buildCard(identity, media));
  } catch {
    paragraph.textContent = 'Attachment could not be displayed.';
  }
}

export function MatrixMediaDomEnhancer({ identity }: MatrixMediaDomEnhancerProps) {
  useEffect(() => {
    function enhanceAll() {
      document.querySelectorAll<HTMLParagraphElement>('.matrix-message__content p').forEach((paragraph) => enhanceParagraph(identity, paragraph));
    }

    const observer = new MutationObserver(enhanceAll);
    observer.observe(document.body, { childList: true, subtree: true });
    const intervalId = window.setInterval(enhanceAll, 1200);
    enhanceAll();

    return () => {
      observer.disconnect();
      window.clearInterval(intervalId);
    };
  }, [identity]);

  return null;
}
