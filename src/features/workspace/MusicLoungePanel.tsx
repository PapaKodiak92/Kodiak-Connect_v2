import { useEffect, useState } from 'react';
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


interface KodiakMusicLibraryTrack {
  albumTitle: string;
  artistName: string;
  durationMs: number;
  explicit: boolean;
  genreNames: string[];
  id: string;
  sourceKind: string;
  streamPath: string;
  title: string;
}

const KODIAK_API_BASE_URL =
  (import.meta.env.VITE_KODIAK_API_BASE_URL as string | undefined)?.trim() || 'https://api.kodiak-connect.com';

function getMusicHeaders(identity: MatrixLoginIdentity) {
  return {
    'Content-Type': 'application/json',
    'X-Kodiak-User-Id': identity.userId,
  };
}

async function searchKodiakMusicLibrary(identity: MatrixLoginIdentity, query: string, limit = 8) {
  const response = await fetch(
    `${KODIAK_API_BASE_URL}/api/music/library/search?userId=${encodeURIComponent(identity.userId)}&q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`,
    { headers: getMusicHeaders(identity) },
  );

  if (!response.ok) {
    throw new Error('Kodiak-Music library search failed.');
  }

  const data = (await response.json()) as { tracks?: KodiakMusicLibraryTrack[] };
  return data.tracks ?? [];
}

async function createKodiakMusicSongRequest(
  identity: MatrixLoginIdentity,
  request: { artistName?: string; note?: string; referenceUrl?: string; title: string },
) {
  const response = await fetch(`${KODIAK_API_BASE_URL}/api/music/requests`, {
    method: 'POST',
    headers: getMusicHeaders(identity),
    body: JSON.stringify({ ...request, userId: identity.userId }),
  });

  if (!response.ok) {
    throw new Error('Kodiak-Music song request failed.');
  }

  return await response.json();
}

interface MusicVibe {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  accent: string;
  tags: string[];
}

const MUSIC_VIBES: MusicVibe[] = [
  {
    id: 'open-library',
    title: 'Open Library',
    subtitle: 'The default Kodiak-Music mix.',
    description: 'A broad room mix pulled from Lupercus-curated library tracks, requests, and community-safe picks.',
    accent: 'Library Mode',
    tags: ['library', 'mixed', 'community'],
  },
  {
    id: 'dev-focus',
    title: 'Dev Focus',
    subtitle: 'Low-distraction background energy.',
    description: 'For coding, patching, shipping, and late-night debugging without derailing chat.',
    accent: 'Focus Mode',
    tags: ['coding', 'focus', 'late night'],
  },
  {
    id: 'throwbacks',
    title: 'Throwbacks',
    subtitle: 'Old favorites and memory-lane tracks.',
    description: 'For when the server needs familiar songs, nostalgia, and singalong momentum.',
    accent: 'Nostalgia',
    tags: ['retro', 'singalong', 'classic'],
  },
  {
    id: 'rock',
    title: 'Rock',
    subtitle: 'Guitars, drums, and momentum.',
    description: 'For lock-in mode, queue crushing, and build nights with more edge.',
    accent: 'Energy',
    tags: ['guitars', 'drums', 'drive'],
  },
  {
    id: 'rap',
    title: 'Rap',
    subtitle: 'Bars, beats, and energy.',
    description: 'For higher-energy dev sessions and community hangouts.',
    accent: 'High Tempo',
    tags: ['beats', 'bars', 'hype'],
  },
  {
    id: 'country',
    title: 'Country',
    subtitle: 'Relaxed, familiar, and easygoing.',
    description: 'For winding down, storytelling, and keeping the room human.',
    accent: 'Easygoing',
    tags: ['relaxed', 'stories', 'open road'],
  },
  {
    id: 'chill',
    title: 'Chill',
    subtitle: 'Calm, smooth, and steady.',
    description: 'For low-stress background listening while people chat.',
    accent: 'Low Stress',
    tags: ['calm', 'smooth', 'ambient'],
  },
];

const LOUNGE_GUIDELINES = [
  'Library curated by Lupercus.',
  'YouTube links stay external for now.',
  'Requests need moderator/library review.',
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

function getSourceLabel(url: string | undefined) {
  if (!url) {
    return 'Library candidate';
  }

  try {
    const hostname = new URL(url).hostname.toLowerCase();

    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return 'YouTube link';
    }

    if (url.includes('/api/music/stream/')) {
      return 'Kodiak-Music library';
    }

    return 'External link';
  } catch {
    if (url.startsWith('/api/music/stream/')) {
      return 'Kodiak-Music library';
    }

    return 'Library candidate';
  }
}

function getOpenTrackLabel(url: string | undefined) {
  const sourceLabel = getSourceLabel(url);

  if (sourceLabel === 'YouTube link') {
    return 'Open YouTube';
  }

  if (sourceLabel === 'External link') {
    return 'Open link';
  }

  return 'Open source';
}

function getLibraryTrackTitle(track: KodiakMusicLibraryTrack) {
  return [track.title, track.artistName].filter(Boolean).join(' - ');
}

export function MusicLoungePanel({ identity }: MusicLoungePanelProps) {
  const [activeVibeId, setActiveVibeId] = useState(getDefaultVibeId);
  const [localVote, setLocalVote] = useState<'up' | 'down' | null>(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchResults, setSearchResults] = useState<KodiakMusicLibraryTrack[]>([]);
  const [queueTitleDraft, setQueueTitleDraft] = useState('');
  const [queueUrlDraft, setQueueUrlDraft] = useState('');
  const [requestTitleDraft, setRequestTitleDraft] = useState('');
  const [requestUrlDraft, setRequestUrlDraft] = useState('');
  const [loungeState, setLoungeState] = useState<KodiakMusicLoungeState | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Loading shared lounge state...');
  const [libraryMessage, setLibraryMessage] = useState('Kodiak-Music library search is ready once the VPS catalog is configured.');

  const activeVibe = MUSIC_VIBES.find((vibe) => vibe.id === activeVibeId) ?? MUSIC_VIBES[0];

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

  async function addSharedQueueTrack(titleOverride?: string, urlOverride?: string) {
    const title = (titleOverride ?? queueTitleDraft).trim();
    const url = (urlOverride ?? queueUrlDraft).trim();

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

  async function addSongRequest() {
    const title = requestTitleDraft.trim();
    const url = requestUrlDraft.trim();

    if (!title) {
      setLibraryMessage('Add the song or artist name before sending a request.');
      return;
    }

    setLibraryMessage('Sending request for Lupercus/library review...');

    try {
      await createKodiakMusicSongRequest(identity, {
        referenceUrl: url,
        title,
      });

      setRequestTitleDraft('');
      setRequestUrlDraft('');
      setLibraryMessage('Request sent for Lupercus/library review.');
    } catch (error) {
      console.error('[Kodiak Music Lounge] Failed to store song request.', error);
      await addSharedQueueTrack(`Request: ${title}`, url);
      setRequestTitleDraft('');
      setRequestUrlDraft('');
      setLibraryMessage('Request storage is not online yet, so it was added to the shared queue instead.');
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

  async function stageLibrarySearch() {
    const query = searchDraft.trim();

    if (!query) {
      setLibraryMessage('Search by song, artist, album, genre, or YouTube link.');
      return;
    }

    setLibraryMessage('Searching the Kodiak-Music catalog...');

    try {
      const tracks = await searchKodiakMusicLibrary(identity, query, 8);
      setSearchResults(tracks);

      if (tracks.length > 0) {
        setLibraryMessage(`Found ${tracks.length} Lupercus-curated library match${tracks.length === 1 ? '' : 'es'}.`);
        return;
      }

      setQueueTitleDraft(query);
      setQueueUrlDraft('');
      setLibraryMessage('No hosted match yet. Staged as a library candidate for the shared queue.');
    } catch (error) {
      console.error('[Kodiak Music Lounge] Failed to search library.', error);
      setSearchResults([]);
      setQueueTitleDraft(query);
      setQueueUrlDraft('');
      setLibraryMessage('Catalog search is not online yet. Staged as a library candidate for the shared queue.');
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
          <p className="eyebrow eyebrow--ember">Kodiak-Music Lounge</p>
          <h2>Library-powered listening.</h2>
          <p>
            Music Lounge is the shared social room. Kodiak-Music is the player. Lupercus curates the library that powers the room from
            a personal 7,000+ track collection.
          </p>
        </div>

        <aside className="music-lounge-now" aria-label="Current lounge vibe">
          <span>Shared vibe</span>
          <strong>{activeVibe.title}</strong>
          <small>Picked by {selectedBy} at {selectedAt}</small>
        </aside>
      </section>

      <section className="music-lounge-library" aria-label="Kodiak-Music library status">
        <div>
          <p className="eyebrow eyebrow--ember">Kodiak-Music Library</p>
          <h3>Curated by Lupercus.</h3>
          <p>
            Lupercus Library Sync will upload approved music to the VPS, store searchable metadata in Postgres, and keep his machine
            from being required for playback.
          </p>
          <small>{libraryMessage}</small>
        </div>

        <div className="music-lounge-library__actions">
          <span>Lupercus Library Sync</span>
          <span>Postgres Catalog</span>
          <span>Streaming API Next</span>
        </div>
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

      <section className="music-lounge-search" aria-label="Kodiak-Music library search">
        <div>
          <p className="eyebrow eyebrow--ember">Library Search</p>
          <h3>Find a Lupercus-curated song.</h3>
          <p>Search the hosted catalog once the VPS database is configured, or stage a missing song as a candidate.</p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void stageLibrarySearch();
          }}
        >
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Search songs, artists, albums, genres..."
          />
          <button type="submit">Search library</button>
        </form>

        {searchResults.length > 0 ? (
          <div className="music-lounge-queue-list" aria-label="Library search results">
            {searchResults.map((track) => (
              <article key={track.id} className="music-lounge-track">
                <div>
                  <strong>{getLibraryTrackTitle(track)}</strong>
                  <small>
                    {track.albumTitle || 'Kodiak-Music'} - {track.genreNames.length ? track.genreNames.join(', ') : 'Library'}
                  </small>
                </div>
                <div className="music-lounge-track__actions">
                  <button
                    type="button"
                    onClick={() => void addSharedQueueTrack(getLibraryTrackTitle(track), track.streamPath)}
                    disabled={isSyncing}
                  >
                    Add to queue
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="music-lounge-now-playing" aria-label="Now playing">
        <div>
          <p className="eyebrow eyebrow--ember">Now Playing</p>
          {nowPlaying ? (
            <>
              <h3>{nowPlaying.title}</h3>
              <p>
                {getSourceLabel(nowPlaying.url)} - Started by {nowPlaying.playedByUserId ? getDisplayName(nowPlaying.playedByUserId) : 'Kodiak'} at{' '}
                {formatSyncTime(nowPlaying.playedAt ?? 0)}
              </p>
            </>
          ) : (
            <>
              <h3>Nothing playing yet.</h3>
              <p>Promote a library song, request, or YouTube link from the queue when the room picks a track.</p>
            </>
          )}
        </div>

        <div className="music-lounge-now-playing__actions">
          {nowPlaying?.url ? (
            <a href={nowPlaying.url} target="_blank" rel="noreferrer">
              {getOpenTrackLabel(nowPlaying.url)}
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
            <p className="eyebrow eyebrow--ember">Lounge Queue</p>
            <h3>Vote on what plays next.</h3>
            <p>Add a hosted-library pick, request, or approved YouTube link. This queue is shared for everyone in the lounge.</p>
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
            placeholder="Song title, artist, or library candidate..."
          />
          <input
            value={queueUrlDraft}
            onChange={(event) => setQueueUrlDraft(event.target.value)}
            placeholder="Optional YouTube or source URL..."
          />
          <button type="submit" disabled={isSyncing || !queueTitleDraft.trim()}>
            Add
          </button>
        </form>

        <div className="music-lounge-queue-list">
          {queue.length === 0 ? (
            <p className="music-lounge-empty">No suggestions yet. Drop the first library pick or YouTube link.</p>
          ) : (
            queue.map((track) => (
              <article key={track.id} className="music-lounge-track">
                <div>
                  <strong>{track.title}</strong>
                  <small>
                    {getSourceLabel(track.url)} - Suggested by {track.addedByUserId ? getDisplayName(track.addedByUserId) : 'Kodiak'} - {' '}
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
                      {getOpenTrackLabel(track.url)}
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

      <section className="music-lounge-request" aria-label="Request a song">
        <div>
          <p className="eyebrow eyebrow--ember">Request a Song</p>
          <h3>Ask for something missing.</h3>
          <p>
            Requests go into the Kodiak-Music review list so Lupercus and moderators can decide what belongs in the hosted library.
          </p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void addSongRequest();
          }}
        >
          <input
            value={requestTitleDraft}
            onChange={(event) => setRequestTitleDraft(event.target.value)}
            placeholder="Song and artist name..."
          />
          <input
            value={requestUrlDraft}
            onChange={(event) => setRequestUrlDraft(event.target.value)}
            placeholder="Optional YouTube/reference link..."
          />
          <button type="submit" disabled={isSyncing || !requestTitleDraft.trim()}>
            Request
          </button>
        </form>
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
