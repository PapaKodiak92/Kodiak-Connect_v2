import { useEffect, useMemo, useState } from 'react';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';
import {
  addKodiakMusicLoungeQueueTrack,
  clearKodiakMusicLoungeNowPlaying,
  clearKodiakMusicLoungeQueue,
  loadKodiakMusicLoungeState,
  removeKodiakMusicLoungeQueueTrack,
  setKodiakMusicLoungeNowPlaying,
  setKodiakMusicLoungeVibe,
  type KodiakMusicLoungeState,
  voteKodiakMusicLoungeQueueTrack,
  voteKodiakMusicLoungeVibe,
} from '../backend/kodiakApiClient';

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
  'Synced queue and voting are shared.',
];

function getDisplayName(userId: string) {
  const withoutPrefix = userId.startsWith('@') ? userId.slice(1) : userId;
  return withoutPrefix.split(':')[0] || userId;
}

function getDefaultVibeId() {
  const thirtyMinutes = 30 * 60 * 1000;
  return MUSIC_VIBES[Math.floor(Date.now() / thirtyMinutes) % MUSIC_VIBES.length]?.id ?? MUSIC_VIBES[0].id;
}

function getValidVibeId(vibeId: string | undefined): string {
  if (vibeId && MUSIC_VIBES.some((vibe) => vibe.id === vibeId)) {
    return vibeId;
  }

  return getDefaultVibeId();
}

function formatSyncTime(timestamp: number) {
  if (!timestamp) {
    return 'Not synced yet';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function MusicLoungePanel({ identity }: MusicLoungePanelProps) {
  const [activeVibeId, setActiveVibeId] = useState(getDefaultVibeId);
  const [localVote, setLocalVote] = useState<'up' | 'down' | null>(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [queueTitleDraft, setQueueTitleDraft] = useState('');
  const [queueUrlDraft, setQueueUrlDraft] = useState('');
  const [loungeState, setLoungeState] = useState<KodiakMusicLoungeState | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Loading shared lounge state...');

  const activeVibe = MUSIC_VIBES.find((vibe) => vibe.id === activeVibeId) ?? MUSIC_VIBES[0];

  const spotifySearchUrl = useMemo(() => {
    const query = searchDraft.trim();

    if (!query) {
      return activeVibe.spotifyUrl;
    }

    return `https://open.spotify.com/search/${encodeURIComponent(query)}`;
  }, [activeVibe.spotifyUrl, searchDraft]);

  function applySharedState(nextState: KodiakMusicLoungeState | null) {
    if (!nextState) {
      return;
    }

    setLoungeState(nextState);
    setActiveVibeId(getValidVibeId(nextState.selectedVibeId));
    setLocalVote(nextState.myVote);
    setStatusMessage('Shared lounge synced.');
  }

  useEffect(() => {
    let isMounted = true;

    async function syncState() {
      try {
        const nextState = await loadKodiakMusicLoungeState(identity);

        if (!isMounted) {
          return;
        }

        applySharedState(nextState);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        console.error('[Kodiak Music Lounge] Failed to load shared state.', error);
        setStatusMessage('Could not sync the shared lounge yet.');
      }
    }

    void syncState();

    const intervalId = window.setInterval(() => {
      void syncState();
    }, 5000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [identity]);

  async function selectSharedVibe(vibeId: string) {
    setActiveVibeId(vibeId);
    setLocalVote(null);
    setIsSyncing(true);
    setStatusMessage('Updating shared vibe...');

    try {
      const nextState = await setKodiakMusicLoungeVibe(identity, vibeId);
      applySharedState(nextState);
    } catch (error) {
      console.error('[Kodiak Music Lounge] Failed to set shared vibe.', error);
      setStatusMessage('Could not update the shared vibe.');
    } finally {
      setIsSyncing(false);
    }
  }

  async function setSharedVote(vote: 'up' | 'down') {
    const nextVote = localVote === vote ? null : vote;

    setLocalVote(nextVote);
    setIsSyncing(true);
    setStatusMessage('Updating vote...');

    try {
      const nextState = await voteKodiakMusicLoungeVibe(identity, nextVote);
      applySharedState(nextState);
    } catch (error) {
      console.error('[Kodiak Music Lounge] Failed to vote on shared vibe.', error);
      setStatusMessage('Could not update your vote.');
    } finally {
      setIsSyncing(false);
    }
  }

  async function addSharedQueueTrack() {
    const title = queueTitleDraft.trim();
    const url = queueUrlDraft.trim();

    if (!title) {
      setStatusMessage('Add a track title first.');
      return;
    }

    setIsSyncing(true);
    setStatusMessage('Adding track suggestion...');

    try {
      const nextState = await addKodiakMusicLoungeQueueTrack(identity, { title, url });
      applySharedState(nextState);
      setQueueTitleDraft('');
      setQueueUrlDraft('');
    } catch (error) {
      console.error('[Kodiak Music Lounge] Failed to add queue track.', error);
      setStatusMessage('Could not add that track.');
    } finally {
      setIsSyncing(false);
    }
  }

  async function removeSharedQueueTrack(trackId: string) {
    setIsSyncing(true);
    setStatusMessage('Removing track suggestion...');

    try {
      const nextState = await removeKodiakMusicLoungeQueueTrack(identity, trackId);
      applySharedState(nextState);
    } catch (error) {
      console.error('[Kodiak Music Lounge] Failed to remove queue track.', error);
      setStatusMessage('Could not remove that track.');
    } finally {
      setIsSyncing(false);
    }
  }

  function canRemoveQueueTrack(addedByUserId: string) {
    return canModerate || addedByUserId === identity.userId;
  }

  async function clearSharedQueue() {
    setIsSyncing(true);
    setStatusMessage('Clearing queue...');

    try {
      const nextState = await clearKodiakMusicLoungeQueue(identity);
      applySharedState(nextState);
    } catch (error) {
      console.error('[Kodiak Music Lounge] Failed to clear queue.', error);
      setStatusMessage('Could not clear the queue.');
    } finally {
      setIsSyncing(false);
    }
  }

  async function playSharedQueueTrack(trackId: string) {
    setIsSyncing(true);
    setStatusMessage('Updating now playing...');

    try {
      const nextState = await setKodiakMusicLoungeNowPlaying(identity, trackId);
      applySharedState(nextState);
    } catch (error) {
      console.error('[Kodiak Music Lounge] Failed to set now playing.', error);
      setStatusMessage('Could not update now playing.');
    } finally {
      setIsSyncing(false);
    }
  }

  async function voteSharedQueueTrack(trackId: string, vote: 'up' | 'down' | null) {
    setIsSyncing(true);
    setStatusMessage('Updating track vote...');

    try {
      const nextState = await voteKodiakMusicLoungeQueueTrack(identity, trackId, vote);
      applySharedState(nextState);
    } catch (error) {
      console.error('[Kodiak Music Lounge] Failed to vote on queue track.', error);
      setStatusMessage('Could not update that track vote.');
    } finally {
      setIsSyncing(false);
    }
  }

  async function clearSharedNowPlaying() {
    setIsSyncing(true);
    setStatusMessage('Clearing now playing...');

    try {
      const nextState = await clearKodiakMusicLoungeNowPlaying(identity);
      applySharedState(nextState);
    } catch (error) {
      console.error('[Kodiak Music Lounge] Failed to clear now playing.', error);
      setStatusMessage('Could not clear now playing.');
    } finally {
      setIsSyncing(false);
    }
  }

  const voteCounts = loungeState?.voteCounts ?? { up: 0, down: 0 };
  const selectedBy = loungeState?.selectedByUserId ? getDisplayName(loungeState.selectedByUserId) : 'Kodiak';
  const selectedAt = formatSyncTime(loungeState?.selectedAt ?? 0);
  const queue = loungeState?.queue ?? [];
  const nowPlaying = loungeState?.nowPlaying ?? null;
  const canModerate = Boolean(loungeState?.canModerate);
  const canClearQueue = canModerate && queue.length > 0;

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
          <span>Shared vibe</span>
          <strong>{activeVibe.title}</strong>
          <small>Picked by {selectedBy} at {selectedAt}</small>
        </aside>
      </section>

      <section className="music-lounge-current" aria-label="Current music vibe">
        <div className="music-lounge-current__main">
          <span className="music-lounge-accent-bar" aria-hidden="true" />
          <div>
            <p className="eyebrow">{activeVibe.accent}</p>
            <h3>{activeVibe.title}</h3>
            <p>{activeVibe.description}</p>

            <div className="music-lounge-tags" aria-label="Vibe tags">
              {activeVibe.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>

            <p className="music-lounge-sync-status">
              {isSyncing ? 'Syncing...' : statusMessage}
            </p>
          </div>
        </div>

        <div className="music-lounge-actions">
          <a href={activeVibe.spotifyUrl} target="_blank" rel="noreferrer">
            Open vibe
          </a>
          <button
            type="button"
            className={localVote === 'up' ? 'music-lounge-vote music-lounge-vote--active' : 'music-lounge-vote'}
            onClick={() => void setSharedVote('up')}
            disabled={isSyncing}
          >
            Like vibe ({voteCounts.up})
          </button>
          <button
            type="button"
            className={localVote === 'down' ? 'music-lounge-vote music-lounge-vote--active' : 'music-lounge-vote'}
            onClick={() => void setSharedVote('down')}
            disabled={isSyncing}
          >
            Not it ({voteCounts.down})
          </button>
        </div>
      </section>

      <section className="music-lounge-search" aria-label="Spotify search">
        <div>
          <p className="eyebrow eyebrow--ember">Search Spotify</p>
          <h3>Bring a track, artist, or mood.</h3>
          <p>Open Spotify search, then paste a track or playlist link below to suggest it to the shared queue.</p>
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

      <section className="music-lounge-now-playing" aria-label="Now playing">
        <div>
          <p className="eyebrow eyebrow--ember">Now Playing</p>
          {nowPlaying ? (
            <>
              <h3>{nowPlaying.title}</h3>
              <p>
                Started by {nowPlaying.playedByUserId ? getDisplayName(nowPlaying.playedByUserId) : 'Kodiak'} at{' '}
                {formatSyncTime(nowPlaying.playedAt ?? 0)}
              </p>
            </>
          ) : (
            <>
              <h3>Nothing playing yet.</h3>
              <p>Promote a suggestion from the queue when the room picks a track.</p>
            </>
          )}
        </div>

        <div className="music-lounge-now-playing__actions">
          {nowPlaying?.url ? (
            <a href={nowPlaying.url} target="_blank" rel="noreferrer">
              Open track
            </a>
          ) : null}
          {nowPlaying && canModerate ? (
            <button type="button" onClick={() => void clearSharedNowPlaying()} disabled={isSyncing}>
              Clear now playing
            </button>
          ) : null}
        </div>
      </section>

      <section className="music-lounge-queue" aria-label="Suggested tracks">
        <div className="music-lounge-queue__header">
          <div>
            <p className="eyebrow eyebrow--ember">Suggested Tracks</p>
            <h3>Build the room queue.</h3>
            <p>Add tracks, playlists, or moods. This is shared for everyone in the lounge.</p>
          </div>

          {canModerate ? (
            <button type="button" onClick={() => void clearSharedQueue()} disabled={isSyncing || !canClearQueue}>
              Clear queue
            </button>
          ) : null}
        </div>

        <form
          className="music-lounge-queue-form"
          onSubmit={(event) => {
            event.preventDefault();
            void addSharedQueueTrack();
          }}
        >
          <input
            value={queueTitleDraft}
            onChange={(event) => setQueueTitleDraft(event.target.value)}
            placeholder="Track, artist, playlist, or vibe..."
          />
          <input
            value={queueUrlDraft}
            onChange={(event) => setQueueUrlDraft(event.target.value)}
            placeholder="Optional Spotify/YouTube/link URL..."
          />
          <button type="submit" disabled={isSyncing || !queueTitleDraft.trim()}>
            Add
          </button>
        </form>

        <div className="music-lounge-queue-list">
          {queue.length === 0 ? (
            <p className="music-lounge-empty">No suggestions yet. Drop the first track.</p>
          ) : (
            queue.map((track) => (
              <article key={track.id} className="music-lounge-track">
                <div>
                  <strong>{track.title}</strong>
                  <small>
                    Suggested by {track.addedByUserId ? getDisplayName(track.addedByUserId) : 'Kodiak'} - {' '}
                    {formatSyncTime(track.addedAt)}
                  </small>
                </div>

                <div className="music-lounge-track__actions">
                  <button
                    type="button"
                    className={track.myVote === 'up' ? 'music-lounge-vote music-lounge-vote--active' : 'music-lounge-vote'}
                    onClick={() => void voteSharedQueueTrack(track.id, track.myVote === 'up' ? null : 'up')}
                    disabled={isSyncing}
                  >
                    Up ({track.voteCounts?.up ?? 0})
                  </button>
                  <button
                    type="button"
                    className={track.myVote === 'down' ? 'music-lounge-vote music-lounge-vote--active' : 'music-lounge-vote'}
                    onClick={() => void voteSharedQueueTrack(track.id, track.myVote === 'down' ? null : 'down')}
                    disabled={isSyncing}
                  >
                    Down ({track.voteCounts?.down ?? 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => void playSharedQueueTrack(track.id)}
                    disabled={isSyncing}
                  >
                    Play now
                  </button>
                  {track.url ? (
                    <a href={track.url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : null}
                  {canRemoveQueueTrack(track.addedByUserId) ? (
                    <button
                      type="button"
                      onClick={() => void removeSharedQueueTrack(track.id)}
                      disabled={isSyncing}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="music-lounge-grid" aria-label="Music vibe options">
        {MUSIC_VIBES.map((vibe) => (
          <button
            key={vibe.id}
            type="button"
            className={vibe.id === activeVibeId ? 'music-lounge-card music-lounge-card--active' : 'music-lounge-card'}
            onClick={() => void selectSharedVibe(vibe.id)}
            disabled={isSyncing}
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
