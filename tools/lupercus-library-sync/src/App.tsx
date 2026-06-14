import { useEffect, useRef, useState } from 'react';

type TrackStatus = 'ready' | 'hashing' | 'hashed' | 'preparing' | 'uploading' | 'uploaded' | 'duplicate' | 'failed';

type SyncTrack = {
  id: string;
  file: File;
  path: string;
  title: string;
  artistName: string;
  sizeBytes: number;
  fileSha256: string;
  selected: boolean;
  status: TrackStatus;
  message: string;
};

const supportedExtensions = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav']);

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

export function App() {
  const filePickerRef = useRef<HTMLInputElement | null>(null);
  const folderPickerRef = useRef<HTMLInputElement | null>(null);
  const [apiBase, setApiBase] = useState('https://api.kodiak-connect.com');
  const [userId, setUserId] = useState('@lupercus:kodiak-connect.com');
  const [deviceId, setDeviceId] = useState('lupercus-main-pc');
  const [genre, setGenre] = useState('');
  const [tracks, setTracks] = useState<SyncTrack[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Choose a few files for testing, or choose a folder for a larger library scan.');

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
        sizeBytes: file.size,
        fileSha256: '',
        selected: true,
        status: 'ready',
        message: 'Ready',
      };
    }));
    setMessage(`Loaded ${audioFiles.length} supported audio files.`);
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
    setMessage('Hash pass complete.');
    setBusy(false);
  }

  async function uploadTrack(track: SyncTrack) {
    if (!track.fileSha256) throw new Error('Hash missing.');
    patchTrack(track.id, { status: 'preparing', message: 'Preparing...' });

    const prepare = await fetch(apiUrl(apiBase, '/api/music/sync/uploads/prepare'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kodiak-User-Id': userId },
      body: JSON.stringify({
        fileName: track.file.name,
        fileSha256: track.fileSha256,
        fileSizeBytes: track.sizeBytes,
        title: track.title,
        artistName: track.artistName,
        genreNames: genre.trim() ? [genre.trim()] : [],
        sourceDeviceId: deviceId,
        originalPath: track.path,
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
    setMessage('Upload pass complete.');
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
        <label>Genre for this batch<input value={genre} onChange={(event) => setGenre(event.target.value)} placeholder="Optional" /></label>
      </section>

      <section className="panel actions">
        <input
          ref={filePickerRef}
          className="hidden-picker"
          type="file"
          multiple
          accept=".aac,.flac,.m4a,.mp3,.ogg,.opus,.wav,audio/*"
          onChange={(event) => loadFiles(event.target.files)}
        />
        <input
          ref={folderPickerRef}
          className="hidden-picker"
          type="file"
          multiple
          accept=".aac,.flac,.m4a,.mp3,.ogg,.opus,.wav,audio/*"
          onChange={(event) => loadFiles(event.target.files)}
        />
        <button disabled={busy} onClick={() => filePickerRef.current?.click()}>Choose files</button>
        <button disabled={busy} onClick={() => folderPickerRef.current?.click()}>Choose folder</button>
        <button disabled={busy} onClick={() => void checkAccess()}>Check access</button>
        <button disabled={busy || tracks.length === 0} onClick={() => void hashSelected()}>Hash selected</button>
        <button disabled={busy || tracks.length === 0} onClick={() => void uploadSelected()}>Upload selected</button>
      </section>

      <section className="panel table-panel">
        <table>
          <thead><tr><th>Use</th><th>Track</th><th>Artist</th><th>Size</th><th>Status</th><th>Message</th></tr></thead>
          <tbody>
            {tracks.map((track) => (
              <tr key={track.id} className={`status-${track.status}`}>
                <td><input type="checkbox" checked={track.selected} onChange={() => patchTrack(track.id, { selected: !track.selected })} /></td>
                <td><strong>{track.title}</strong><small>{track.path}</small></td>
                <td>{track.artistName || 'Unknown'}</td>
                <td>{bytes(track.sizeBytes)}</td>
                <td>{track.status}</td>
                <td>{track.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
