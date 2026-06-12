import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/global.css';
import './styles/brand.css';
import './styles/launcher.css';
import './styles/acknowledgement.css';
import './styles/matrix-chat.css';
import './styles/workspace-polish.css';
import './styles/typing-indicator.css';
import './styles/safety-center.css';
import './styles/workspace-surfaces.css';
import './styles/attachment-bridge.css';
import './styles/layout-repair.css';
import './styles/client-hotfix.css';
import './styles/mobile-workspace-overhaul.css';
import './styles/composer-tools-redesign.css';
import './styles/call-permission-prompt.css';
import './styles/call-panel-polish.css';
import './styles/music-lounge.css';
import './styles/message-formatting.css';
import './styles/mobile-member-panel-slide.css';
import './styles/collapsible-layout.css';
import './styles/mobile-final-shell.css';

function clearStaleAvatarObjectUrls() {
  const cacheKey = 'KC_BACKEND_PROFILE_CACHE';

  try {
    const rawCache = window.localStorage.getItem(cacheKey);

    if (!rawCache) {
      return;
    }

    const cache = JSON.parse(rawCache) as {
      avatars?: Record<string, string>;
      bios?: Record<string, string>;
      displayNames?: Record<string, string>;
    };

    const avatars = Object.fromEntries(
      Object.entries(cache.avatars ?? {}).filter(([, avatarUrl]) => {
        return typeof avatarUrl === 'string' && avatarUrl.trim() && !avatarUrl.startsWith('blob:');
      }),
    );

    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        ...cache,
        avatars,
      }),
    );
  } catch {
    window.localStorage.removeItem(cacheKey);
  }
}

clearStaleAvatarObjectUrls();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
