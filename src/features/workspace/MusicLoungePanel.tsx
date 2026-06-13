import { useMemo, useState } from 'react';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';

interface MusicLoungePanelProps {
  identity: MatrixLoginIdentity;
}

interface MusicVibe {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  accent: string;
  spotifyUrl: string;
  tags: string[];
}

const MUSIC_VIBES: MusicVibe[] = [
  {
    id: 'random-hits',
    title: 'Random Hits',
    subtitle: 'A little bit of everything.',
    description: 'The default room vibe when nobody knows what to play.',
    accent: 'Open Room',
    spotifyUrl: 'https://open.spotify.com/search/top%20hits',
    tags: ['mixed', 'party', 'community'],
  },
  {
    id: 'dev-focus',
    title: 'Dev Focus',
    subtitle: 'Low-distraction background energy.',
    description: 'For coding, patching, shipping, and late-night debugging.',
    accent: 'Focus Mode',
    spotifyUrl: 'https://open.spotify.com/search/focus%20coding',
    tags: ['coding', 'focus', 'late night'],
  },
  {
    id: 'throwbacks',
    title: 'Throwbacks',
    subtitle: 'Old favorites and memory-lane tracks.',
    description: 'For when the server needs nostalgia instead of chaos.',
    accent: 'Nostalgia',
    spotifyUrl: 'https://open.spotify.com/search/throwback%20hits',
    tags: ['retro', 'singalong', 'classic'],
  },
  {
    id: 'rock',
    title: 'Rock',
    subtitle: 'Guitars, drums, and momentum.',
    description: 'For lock-in mode, queue crushing, and build nights.',
    accent: 'Energy',
    spotifyUrl: 'https://open.spotify.com/search/rock%20hits',
    tags: ['guitars', 'drums', 'drive'],
  },
  {
    id: 'rap',
    title: 'Rap',
    subtitle: 'Bars, beats, and energy.',
    description: 'For higher-energy dev sessions and community hangouts.',
    accent: 'High Tempo',
    spotifyUrl: 'https://open.spotify.com/search/rap%20hits',
    tags: ['beats', 'bars', 'hype'],
  },
  {
    id: 'country',
    title: 'Country',
    subtitle: 'Relaxed, familiar, and easygoing.',
    description: 'For winding down and keeping the room human.',
    accent: 'Easygoing',
    spotifyUrl: 'https://open.spotify.com/search/country%20hits',
    tags: ['relaxed', 'stories', 'open road'],
  },
  {
    id: 'chill',
    title: 'Chill',
    subtitle: 'Calm, smooth, and steady.',
    description: 'For low-stress background listening while people chat.',
    accent: 'Low Stress',
    spotifyUrl: 'https://open.spotify.com/search/chill%20hits',
    tags: ['calm', 'smooth', 'ambient'],
  },
];

const LOUNGE_GUIDELINES = [
  'Keep it community-safe.',
  'Use Spotify links for now.',
  'Synced queues and voting come next.',
];

function getDisplayName(userId: string) {
  const withoutPrefix = userId.startsWith('@') ? userId.slice(1) : userId;
  return withoutPrefix.split(':')[0] || userId;
}

function getDefaultVibeId() {
  const thirtyMinutes = 30 * 60 * 1000;
  return MUSIC_VIBES[Math.floor(Date.now() / thirtyMinutes) % MUSIC_VIBES.length]?.id ?? MUSIC_VIBES[0].id;
}

export function MusicLoungePanel({ identity }: MusicLoungePanelProps) {
  const [activeVibeId, setActiveVibeId] = useState(getDefaultVibeId);
  const [localVote, setLocalVote] = useState<'up' | 'down' | null>(null);
  const [searchDraft, setSearchDraft] = useState('');

  const activeVibe = MUSIC_VIBES.find((vibe) => vibe.id === activeVibeId) ?? MUSIC_VIBES[0];

  const spotifySearchUrl = useMemo(() => {
    const query = searchDraft.trim();

    if (!query) {
      return activeVibe.spotifyUrl;
    }

    return `https://open.spotify.com/search/${encodeURIComponent(query)}`;
  }, [activeVibe.spotifyUrl, searchDraft]);

  return (
    <div className="music-lounge-panel">
      <section className="music-lounge-hero">
        <div className="music-lounge-hero__copy">
          <p className="eyebrow eyebrow--ember">Kodiak Music Lounge</p>
          <h2>Set the room vibe.</h2>
          <p>
            A dedicated hangout for shared music taste, focus sessions, late-night building, and community listening.
            Spotify opens on each user&apos;s own account/device while we build synced lounge features.
          </p>
        </div>

        <aside className="music-lounge-now" aria-label="Current lounge vibe">
          <span>Now selected</span>
          <strong>{activeVibe.title}</strong>
          <small>{activeVibe.subtitle}</small>
        </aside>
      </section>

      <section className="music-lounge-current" aria-label="Current music vibe">
        <div className="music-lounge-current__main">
          <span className="music-lounge-orb" aria-hidden="true">?</span>
          <div>
            <p className="eyebrow">{activeVibe.accent}</p>
            <h3>{activeVibe.title}</h3>
            <p>{activeVibe.description}</p>

            <div className="music-lounge-tags" aria-label="Vibe tags">
              {activeVibe.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="music-lounge-actions">
          <a href={activeVibe.spotifyUrl} target="_blank" rel="noreferrer">
            Open vibe
          </a>
          <button
            type="button"
            className={localVote === 'up' ? 'music-lounge-vote music-lounge-vote--active' : 'music-lounge-vote'}
            onClick={() => setLocalVote(localVote === 'up' ? null : 'up')}
          >
            Like vibe
          </button>
          <button
            type="button"
            className={localVote === 'down' ? 'music-lounge-vote music-lounge-vote--active' : 'music-lounge-vote'}
            onClick={() => setLocalVote(localVote === 'down' ? null : 'down')}
          >
            Not it
          </button>
        </div>
      </section>

      <section className="music-lounge-search" aria-label="Spotify search">
        <div>
          <p className="eyebrow eyebrow--ember">Search Spotify</p>
          <h3>Bring a track, artist, or mood.</h3>
          <p>For now this opens Spotify search. Queue sharing and room-wide votes come next on this branch.</p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            window.open(spotifySearchUrl, '_blank', 'noopener,noreferrer');
          }}
        >
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Search songs, artists, playlists..."
          />
          <button type="submit">Open Spotify</button>
        </form>
      </section>

      <section className="music-lounge-grid" aria-label="Music vibe options">
        {MUSIC_VIBES.map((vibe) => (
          <button
            key={vibe.id}
            type="button"
            className={vibe.id === activeVibeId ? 'music-lounge-card music-lounge-card--active' : 'music-lounge-card'}
            onClick={() => {
              setActiveVibeId(vibe.id);
              setLocalVote(null);
            }}
          >
            <span>{vibe.id === activeVibeId ? 'Selected vibe' : vibe.accent}</span>
            <strong>{vibe.title}</strong>
            <small>{vibe.subtitle}</small>
            <p>{vibe.description}</p>
          </button>
        ))}
      </section>

      <footer className="music-lounge-footer">
        <span>Tuned in as {getDisplayName(identity.userId)}</span>
        <div>
          {LOUNGE_GUIDELINES.map((guideline) => (
            <span key={guideline}>{guideline}</span>
          ))}
        </div>
      </footer>
    </div>
  );
}
