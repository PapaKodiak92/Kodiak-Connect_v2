import { updateManifest } from './updateManifest';

export function UpdaterPanel() {
  return (
    <section className="panel" aria-labelledby="updater-title">
      <div>
        <p className="eyebrow">Installers first</p>
        <h2 id="updater-title">Updater foundation</h2>
      </div>

      <ul className="checklist">
        <li>Version manifest: {updateManifest.currentVersion}</li>
        <li>Tauri desktop updater: pending signed release URL</li>
        <li>Android APK release path: pending generated native project</li>
        <li>Web deploy path: VPS-ready static build</li>
      </ul>
    </section>
  );
}
