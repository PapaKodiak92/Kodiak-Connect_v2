import { usePlatformInfo } from '../platform/usePlatformInfo';
import { UpdaterPanel } from '../features/updater/UpdaterPanel';

export function AppShell() {
  const platform = usePlatformInfo();

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">Kodiak Connect v2</p>
        <h1>Secure chat foundation</h1>
        <p className="lede">
          Web, Android, Windows, and Linux are first-class targets before Matrix chat features are added.
        </p>

        <dl className="status-grid" aria-label="Foundation status">
          <div>
            <dt>Platform</dt>
            <dd>{platform.kind}</dd>
          </div>
          <div>
            <dt>Updater</dt>
            <dd>Scaffolded</dd>
          </div>
          <div>
            <dt>Matrix</dt>
            <dd>Not wired yet</dd>
          </div>
        </dl>
      </section>

      <UpdaterPanel />
    </main>
  );
}
