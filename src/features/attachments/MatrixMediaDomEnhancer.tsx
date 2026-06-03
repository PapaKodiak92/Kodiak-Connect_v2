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

function isAuthenticatedMatrixMediaUrl(mediaUrl: string) {
  return mediaUrl.includes('/_matrix/client/v1/media/') ||
    mediaUrl.includes('/_matrix/media/v3/') ||
    mediaUrl.includes('/_matrix/media/r0/');
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


async function chooseDomEnhancerSavePath(suggestedName: string) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('choose_save_path', { suggestedName });
}

async function writeDomEnhancerFile(savePath: string, blob: Blob) {
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));

  await invoke('write_downloaded_file', {
    path: savePath,
    bytes,
  });
}
function createDownloadButton(
  identity: MatrixLoginIdentity,
  mediaUrl: string,
  fileName: string,
  _trackObjectUrl: (url: string) => void,
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'matrix-media-message__open';
  button.textContent = 'Download';

  button.addEventListener('click', async () => {
    const originalText = button.textContent;

    try {
      button.disabled = true;
      button.textContent = 'Choose location...';

      const savePath = await chooseDomEnhancerSavePath(fileName);

      if (!savePath) {
        button.textContent = 'Canceled';
        window.setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
        }, 1200);
        return;
      }

      button.textContent = 'Downloading...';

      const blob = isAuthenticatedMatrixMediaUrl(mediaUrl)
        ? await fetchAuthenticatedBlob(identity, mediaUrl)
        : await fetch(mediaUrl).then((response) => {
            if (!response.ok) {
              throw new Error('File download failed.');
            }

            return response.blob();
          });

      button.textContent = 'Saving...';
      await writeDomEnhancerFile(savePath, blob);

      button.textContent = 'Saved';

      window.setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 1800);
    } catch (error) {
      console.error('[Kodiak Connect] Authenticated media download failed', error);
      button.textContent = 'Failed';

      window.setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 1800);
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
  if (!isAuthenticatedMatrixMediaUrl(mediaUrl)) {
    previewElement.src = mediaUrl;
    return;
  }

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



