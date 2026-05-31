export function KodiakSplashScreen() {
  return (
    <div className="splash-screen" role="status" aria-live="polite">
      <div className="brand-orb brand-orb--large" aria-hidden="true">
        🐻
      </div>
      <div className="splash-screen__copy">
        <p className="eyebrow eyebrow--ember">Kodiak Connect</p>
        <h1>Preparing secure space</h1>
        <p>Loading trusted platform services...</p>
      </div>
    </div>
  );
}
