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

async function fetchAuthenticatedBlob(identity: MatrixLoginIdentity, mediaUrl: string) {
  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: `Bearer ${identity.accessToken}`,
    },
  });

  if (!response.ok) {
    let message = 'Matrix media download failed.';

    try {
      const body = (await response.json()) as { error?: string };
      message = body.error || message;
    } catch {
      // Keep fallback message.
    }

    throw new Error(message);
  }

  return response.blob();
}

function appendDetails(card: HTMLElement, media: EncodedMediaMessage, fileName: string) {
  const details = document.createElement('span');
  details.className = 'matrix-media-message__details';

  const name = document.createElement('strong');
  name.textContent = fileName;

  const meta = document.createElement('small');
  meta.textContent = [media.info?.mimetype, formatSize(media.info?.size)].filter(Boolean).join(' - ');

  details.append(name, meta);
  card.append(details);
}

function appendError(card: HTMLElement, message: string) {
  const error = document.createElement('span');
  error.className = 'matrix-media-message__error';
  error.textContent = message;
  card.append(error);
}

function createDownloadButton(
  identity: MatrixLoginIdentity,
  mediaUrl: string,
  fileName: string,
  trackObjectUrl: (url: string) => void,
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'matrix-media-message__open';
  button.textContent = 'Download';

  button.addEventListener('click', async () => {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Downloading...';

    try {
      const blob = await fetchAuthenticatedBlob(identity, mediaUrl);
      const objectUrl = URL.createObjectURL(blob);
      trackObjectUrl(objectUrl);

      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    } catch (error) {
      console.error('[Kodiak Connect] Authenticated media download failed', error);
      button.textContent = 'Failed';

      window.setTimeout(() => {
        button.textContent = originalText;
      }, 1800);
    } finally {
      button.disabled = false;
    }
  });

  return button;
}

function loadPreview(
  identity: MatrixLoginIdentity,
  previewElement: HTMLImageElement | HTMLAudioElement | HTMLVideoElement,
  mediaUrl: string,
  trackObjectUrl: (url: string) => void,
) {
  void fetchAuthenticatedBlob(identity, mediaUrl)
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      trackObjectUrl(objectUrl);
      previewElement.src = objectUrl;
    })
    .catch((error) => {
      console.error('[Kodiak Connect] Authenticated media preview failed', error);
      previewElement.replaceWith(document.createTextNode('Preview unavailable. Use Download.'));
    });
}

function buildCard(
  identity: MatrixLoginIdentity,
  media: EncodedMediaMessage,
  trackObjectUrl: (url: string) => void,
) {
  const card = document.createElement('span');
  card.className = `matrix-media-message matrix-media-message--${media.msgtype?.replace('m.', '') || 'file'}`;

  const mediaUrl = getMediaUrl(identity, media.url);
  const fileName = getFileName(media.body);

  let previewElement: HTMLImageElement | HTMLAudioElement | HTMLVideoElement | null = null;

  if (mediaUrl && media.msgtype === 'm.image') {
    const image = document.createElement('img');
    image.alt = fileName;
    image.loading = 'lazy';
    previewElement = image;
    card.append(image);
  }

  if (mediaUrl && media.msgtype === 'm.audio') {
    const audio = document.createElement('audio');
    audio.controls = true;
    previewElement = audio;
    card.append(audio);
  }

  if (mediaUrl && media.msgtype === 'm.video') {
    const video = document.createElement('video');
    video.controls = true;
    previewElement = video;
    card.append(video);
  }

  appendDetails(card, media, fileName);

  if (mediaUrl && previewElement) {
    loadPreview(identity, previewElement, mediaUrl, trackObjectUrl);
  }

  if (mediaUrl) {
    card.append(createDownloadButton(identity, mediaUrl, fileName, trackObjectUrl));
  } else {
    appendError(card, 'Attachment URL missing.');
  }

  return card;
}

function enhanceParagraph(
  identity: MatrixLoginIdentity,
  paragraph: HTMLParagraphElement,
  trackObjectUrl: (url: string) => void,
) {
  if (paragraph.dataset.kodiakMediaEnhanced === 'true') return;

  const rawText = paragraph.textContent?.trim() ?? '';
  if (!rawText.startsWith(MEDIA_PREFIX)) return;

  paragraph.dataset.kodiakMediaEnhanced = 'true';

  try {
    const media = JSON.parse(rawText.slice(MEDIA_PREFIX.length)) as EncodedMediaMessage;
    paragraph.replaceChildren(buildCard(identity, media, trackObjectUrl));
  } catch {
    paragraph.textContent = 'Attachment could not be displayed.';
  }
}

export function MatrixMediaDomEnhancer({ identity }: MatrixMediaDomEnhancerProps) {
  useEffect(() => {
    const objectUrls = new Set<string>();

    function trackObjectUrl(url: string) {
      objectUrls.add(url);
    }

    function enhanceAll() {
      document
        .querySelectorAll<HTMLParagraphElement>('.matrix-message__content p')
        .forEach((paragraph) => enhanceParagraph(identity, paragraph, trackObjectUrl));
    }

    const observer = new MutationObserver(enhanceAll);
    observer.observe(document.body, { childList: true, subtree: true });

    const intervalId = window.setInterval(enhanceAll, 1200);
    enhanceAll();

    return () => {
      observer.disconnect();
      window.clearInterval(intervalId);
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.clear();
    };
  }, [identity]);

  return null;
}
