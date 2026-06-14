import { useEffect, useRef, useState } from 'react';

type TrackStatus = 'ready' | 'hashing' | 'hashed' | 'preparing' | 'uploading' | 'uploaded' | 'duplicate' | 'failed';

type SyncTrack = {
  id: string;
  file: File;
  path: string;
  title: string;
  artistName: string;
  albumTitle: string;
  genreNames: string;
  releaseYear: string;
  trackNumber: string;
  sizeBytes: number;
  fileSha256: string;
  selected: boolean;
  status: TrackStatus;
  message: string;
};

type LibraryTrack = {
  id: string;
  title: string;
  artistName?: string;
  albumTitle?: string;
  genreNames?: string[];
  fileSha256?: string;
  streamPath?: string;
};

const supportedExtensions = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav']);
const supportedExtensionLabel = '.aac, .flac, .m4a, .mp3, .ogg, .opus, .wav';

function ext(name: string) {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function titleFromName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function guessArtist(file: File) {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const parts = path.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2].replace(/[_-]+/g, ' ') : '';
}

function guessAlbum(file: File) {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const parts = path.split('/').filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 2].replace(/[_-]+/g, ' ') : '';
}

function bytes(value: number) {
  return value > 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
}

function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashFile(file: File) {
  return hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
}

function apiUrl(apiBase: string, path: string) {
  return new URL(path, apiBase.endsWith('/') ? apiBase : `${apiBase}/`).toString();
}

function err(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function parseGenres(value: string) {
  return value
    .split(',')
    .map((genre) => genre.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function parsePositiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function App() {
  const filePickerRef = useRef<HTMLInputElement | null>(null);
  const folderPickerRef = useRef<HTMLInputElement | null>(null);
  const [apiBase, setApiBase] = useState('https://api.kodiak-connect.com');
  const [userId, setUserId] = useState('@lupercus:kodiak-connect.com');
  const [deviceId, setDeviceId] = useState('lupercus-main-pc');
  const [genre, setGenre] = useState('');
  const [tracks, setTracks] = useState<SyncTrack[]>([]);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryResults, setLibraryResults] = useState<LibraryTrack[]>([]);
  const [libraryMessage, setLibraryMessage] = useState('Search uploaded Kodiak-Music tracks to review or delete them. Delete requires moderator access.');
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null);
  const [confirmDeleteTrack, setConfirmDeleteTrack] = useState<LibraryTrack | null>(null);
  const [busy, setBusy] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [message, setMessage] = useState('Choose files for testing, or choose a folder for a larger library scan. Edit metadata before upload.');

  useEffect(() => {
    folderPickerRef.current?.setAttribute('webkitdirectory', '');
    folderPickerRef.current?.setAttribute('directory', '');
  }, []);

  function patchTrack(id: string, updates: Partial<SyncTrack>) {
    setTracks((current) => current.map((track) => (track.id === id ? { ...track, ...updates } : track)));
  }

  function loadFiles(files: FileList | null) {
    const audioFiles = Array.from(files || []).filter((file) => supportedExtensions.has(ext(file.name)));
    setTracks(audioFiles.map((file, index) => {
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      return {
        id: `${path}-${file.size}-${file.lastModified}-${index}`,
        file,
        path,
        title: titleFromName(file.name),
        artistName: guessArtist(file),
        albumTitle: guessAlbum(file),
        genreNames: genre,
        releaseYear: '',
        trackNumber: '',
        sizeBytes: file.size,
        fileSha256: '',
        selected: true,
        status: 'ready',
        message: 'Ready. Edit metadata, then hash.',
      };
    }));
    setMessage(`Loaded ${audioFiles.length} supported audio files. Supported formats: ${supportedExtensionLabel}.`);
  }

  async function checkAccess() {
    setBusy(true);
    setMessage('Checking sync access...');
    try {
      const response = await fetch(apiUrl(apiBase, `/api/music/sync/health?userId=${encodeURIComponent(userId)}`), {
        headers: { 'X-Kodiak-User-Id': userId },
      });
      const data = await response.json() as { canSync?: boolean; database?: { ok?: boolean }; storage?: { ok?: boolean } };
      setMessage(data.canSync && data.database?.ok && data.storage?.ok ? 'Sync API is ready.' : 'Sync API is not ready for this user yet.');
    } catch (error) {
      setMessage(`Health check failed: ${err(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function searchLibrary() {
    setLibraryBusy(true);
    setLibraryMessage('Searching hosted Kodiak-Music library...');
    try {
      const query = libraryQuery.trim();
      const response = await fetch(apiUrl(apiBase, `/api/music/library/search?q=${encodeURIComponent(query)}&limit=50&userId=${encodeURIComponent(userId)}`), {
        headers: { 'X-Kodiak-User-Id': userId },
      });
      const data = await response.json() as { tracks?: LibraryTrack[]; error?: string };
      if (!response.ok) throw new Error(data.error || `Search failed: ${response.status}`);
      setLibraryResults(data.tracks || []);
      setLibraryMessage(`Found ${(data.tracks || []).length} hosted track(s).`);
    } catch (error) {
      setLibraryMessage(`Library search failed: ${err(error)}`);
    } finally {
      setLibraryBusy(false);
    }
  }

  async function deleteLibraryTrack(track: LibraryTrack) {
    setConfirmDeleteTrack(null);
    setDeletingTrackId(track.id);
    setLibraryMessage(`Deleting ${track.title}...`);
    try {
      const response = await fetch(apiUrl(apiBase, '/api/music/library/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kodiak-User-Id': userId },
        body: JSON.stringify({ userId, trackId: track.id }),
      });
      const data = await response.json() as { error?: string; fileRemoved?: boolean };
      if (!response.ok) throw new Error(data.error || `Delete failed: ${response.status}`);
      setLibraryResults((current) => current.filter((item) => item.id !== track.id));
      setLibraryMessage(`Deleted ${track.title}${data.fileRemoved ? ' and removed the stored file' : ''}.`);
    } catch (error) {
      setLibraryMessage(`Delete failed: ${err(error)}`);
    } finally {
      setDeletingTrackId(null);
    }
  }

  async function hashSelected() {
    setBusy(true);
    for (const track of tracks.filter((item) => item.selected && !item.fileSha256)) {
      patchTrack(track.id, { status: 'hashing', message: 'Hashing...' });
      try {
        const fileSha256 = await hashFile(track.file);
        patchTrack(track.id, { fileSha256, status: 'hashed', message: fileSha256 });
      } catch (error) {
        patchTrack(track.id, { status: 'failed', message: err(error) });
      }
    }
    setMessage('Hash pass complete. Metadata can still be edited before upload.');
    setBusy(false);
  }

  async function uploadTrack(track: SyncTrack) {
    if (!track.fileSha256) throw new Error('Hash missing.');
    patchTrack(track.id, { status: 'preparing', message: 'Preparing...' });

    const prepare = await fetch(apiUrl(apiBase, '/api/music/sync/uploads/prepare'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kodiak-User-Id': userId },
      body: JSON.stringify({
        albumTitle: track.albumTitle,
        fileName: track.file.name,
        fileSha256: track.fileSha256,
        fileSizeBytes: track.sizeBytes,
        genreNames: parseGenres(track.genreNames || genre),
        originalPath: track.path,
        releaseYear: parsePositiveNumber(track.releaseYear),
        sourceDeviceId: deviceId,
        title: track.title,
        trackNumber: parsePositiveNumber(track.trackNumber),
        artistName: track.artistName,
      }),
    });
    const prepared = await prepare.json() as { shouldUpload?: boolean; uploadUrl?: string; reason?: string };
    if (!prepare.ok) throw new Error(prepared.reason || `Prepare failed: ${prepare.status}`);
    if (!prepared.shouldUpload) {
      patchTrack(track.id, { status: 'duplicate', message: prepared.reason || 'Already exists.' });
      return;
    }
    if (!prepared.uploadUrl) throw new Error('Missing uploadUrl.');

    patchTrack(track.id, { status: 'uploading', message: 'Uploading...' });
    const uploaded = await fetch(apiUrl(apiBase, prepared.uploadUrl), {
      method: 'PUT',
      headers: { 'Content-Type': track.file.type || 'application/octet-stream', 'X-Kodiak-User-Id': userId },
      body: track.file,
    });
    if (!uploaded.ok) throw new Error(await uploaded.text());
    patchTrack(track.id, { status: 'uploaded', message: 'Uploaded.' });
  }

  async function uploadSelected() {
    setBusy(true);
    for (const track of tracks.filter((item) => item.selected && item.status === 'hashed')) {
      try {
        await uploadTrack(track);
      } catch (error) {
        patchTrack(track.id, { status: 'failed', message: err(error) });
      }
    }
    setMessage('Upload pass complete. Search the hosted library below to verify uploaded tracks.');
    setBusy(false);
  }

  return (
    <main className="sync-shell">
      <section className="hero-card">
        <p>Kodiak-Music Curator Tool</p>
        <h1>Lupercus Library Sync</h1>
        <span>{message}</span>
      </section>

      <section className="panel settings-grid">
        <label>API base<input value={apiBase} onChange={(event) => setApiBase(event.target.value)} /></label>
        <label>Matrix user ID<input value={userId} onChange={(event) => setUserId(event.target.value)} /></label>
        <label>Device ID<input value={deviceId} onChange={(event) => setDeviceId(event.target.value)} /></label>
        <label>Default genre for new files<input value={genre} onChange={(event) => setGenre(event.target.value)} placeholder="Optional" /></label>
      </section>

      <section className="panel actions">
        <input ref={filePickerRef} style={{ display: 'none' }} type="file" multiple accept=".aac,.flac,.m4a,.mp3,.ogg,.opus,.wav,audio/*" onChange={(event) => loadFiles(event.target.files)} />
        <input ref={folderPickerRef} style={{ display: 'none' }} type="file" multiple accept=".aac,.flac,.m4a,.mp3,.ogg,.opus,.wav,audio/*" onChange={(event) => loadFiles(event.target.files)} />
        <button disabled={busy} onClick={() => filePickerRef.current?.click()}>Choose files</button>
        <button disabled={busy} onClick={() => folderPickerRef.current?.click()}>Choose folder</button>
        <button disabled={busy} onClick={() => void checkAccess()}>Check access</button>
        <button disabled={busy || tracks.length === 0} onClick={() => void hashSelected()}>Hash selected</button>
        <button disabled={busy || tracks.length === 0} onClick={() => void uploadSelected()}>Upload selected</button>
        <span className="format-note">Supported: {supportedExtensionLabel}</span>
      </section>

      <section className="panel library-manager">
        <div>
          <p className="eyebrow">Hosted Kodiak-Music Library</p>
          <h2>Review uploaded tracks</h2>
          <span>{libraryMessage}</span>
        </div>
        <div className="library-search-row">
          <input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search title, artist, album, genre, or leave blank for latest" />
          <button disabled={libraryBusy} onClick={() => void searchLibrary()}>{libraryBusy ? 'Searching...' : 'Search library'}</button>
        </div>
        <div className="library-results">
          {libraryResults.map((track) => (
            <article key={track.id} className="library-result-card">
              <div>
                <strong>{track.title || 'Untitled track'}</strong>
                <small>{[track.artistName, track.albumTitle].filter(Boolean).join(' • ') || 'No artist/album set'}</small>
                <small>{(track.genreNames || []).join(', ') || 'No genres'}{track.fileSha256 ? ` • ${track.fileSha256.slice(0, 12)}...` : ''}</small>
              </div>
              <button className="danger-button" disabled={deletingTrackId === track.id} onClick={() => setConfirmDeleteTrack(track)}>
                {deletingTrackId === track.id ? 'Deleting...' : 'Delete'}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="panel table-panel">
        <table>
          <thead><tr><th>Use</th><th>File</th><th>Editable metadata</th><th>Size</th><th>Status</th><th>Message</th></tr></thead>
          <tbody>
            {tracks.map((track) => (
              <tr key={track.id} className={`status-${track.status}`}>
                <td><input type="checkbox" checked={track.selected} onChange={() => patchTrack(track.id, { selected: !track.selected })} /></td>
                <td><strong>{track.file.name}</strong><small>{track.path}</small></td>
                <td>
                  <div className="metadata-grid">
                    <label>Title<input value={track.title} onChange={(event) => patchTrack(track.id, { title: event.target.value })} /></label>
                    <label>Artist<input value={track.artistName} onChange={(event) => patchTrack(track.id, { artistName: event.target.value })} /></label>
                    <label>Album<input value={track.albumTitle} onChange={(event) => patchTrack(track.id, { albumTitle: event.target.value })} /></label>
                    <label>Genre(s)<input value={track.genreNames} onChange={(event) => patchTrack(track.id, { genreNames: event.target.value })} placeholder="Rock, Live, Demo" /></label>
                    <label>Year<input value={track.releaseYear} onChange={(event) => patchTrack(track.id, { releaseYear: event.target.value.replace(/[^0-9]/g, '').slice(0, 4) })} placeholder="Optional" /></label>
                    <label>Track #<input value={track.trackNumber} onChange={(event) => patchTrack(track.id, { trackNumber: event.target.value.replace(/[^0-9]/g, '').slice(0, 3) })} placeholder="Optional" /></label>
                  </div>
                </td>
                <td>{bytes(track.sizeBytes)}</td>
                <td>{track.status}</td>
                <td>{track.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {confirmDeleteTrack ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfirmDeleteTrack(null)}>
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-track-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow danger-eyebrow">Delete hosted track</p>
            <h2 id="delete-track-title">Remove this song from Kodiak-Music?</h2>
            <p>
              This will remove <strong>{confirmDeleteTrack.title || 'Untitled track'}</strong> from the hosted library catalog and delete the stored audio file.
            </p>
            <div className="modal-track-summary">
              <span>{[confirmDeleteTrack.artistName, confirmDeleteTrack.albumTitle].filter(Boolean).join(' • ') || 'No artist/album set'}</span>
              <small>{(confirmDeleteTrack.genreNames || []).join(', ') || 'No genres set'}</small>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => setConfirmDeleteTrack(null)}>Cancel</button>
              <button type="button" className="danger-button" onClick={() => void deleteLibraryTrack(confirmDeleteTrack)}>Delete from library</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
