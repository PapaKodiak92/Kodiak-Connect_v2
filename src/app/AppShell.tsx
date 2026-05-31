import { AuthLanding } from '../features/auth/AuthLanding';
import { useAuthController } from '../features/auth/useAuthController';
import { UpdaterPanel } from '../features/updater/UpdaterPanel';
import { AppFrame } from '../components/layout/AppFrame';
import { usePlatformInfo } from '../platform/usePlatformInfo';

export function AppShell() {
  const platform = usePlatformInfo();
  const auth = useAuthController();

  if (auth.mode === 'signed-out') {
    return (
      <main className="app-shell">
        <section className="hero-card">
          <p className="eyebrow">Kodiak Connect v2</p>
          <h1>Secure chat foundation</h1>
          <p className="lede">
            Web, Android, Windows, and Linux are first-class targets before Matrix chat features are added.
          </p>
        </section>

        <AuthLanding onEnterPreview={auth.enterLocalPreview} />
        <UpdaterPanel />
      </main>
    );
  }

  return (
    <main className="app-shell app-shell--wide">
      <AppFrame user={auth.user} onExit={auth.signOut}>
        <section className="hero-card">
          <p className="eyebrow">Local preview</p>
          <h1>App shell online</h1>
          <p className="lede">
            This state proves the app can switch between auth and workspace views without Matrix logic entering App.tsx.
          </p>

          <dl className="status-grid" aria-label="Foundation status">
            <div>
              <dt>Platform</dt>
              <dd>{platform.kind}</dd>
            </div>
            <div>
              <dt>Auth</dt>
              <dd>{auth.mode}</dd>
            </div>
            <div>
              <dt>Matrix</dt>
              <dd>Not wired yet</dd>
            </div>
          </dl>
        </section>

        <UpdaterPanel />
      </AppFrame>
    </main>
  );
}
