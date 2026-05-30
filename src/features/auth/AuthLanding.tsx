interface AuthLandingProps {
  onEnterPreview: () => void;
}

export function AuthLanding({ onEnterPreview }: AuthLandingProps) {
  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <p className="eyebrow">Access layer</p>
      <h2 id="auth-title">Sign in foundation</h2>
      <p className="lede">
        This placeholder keeps authentication isolated while the app shell, release pipeline, and platform targets stay stable.
      </p>

      <div className="button-row">
        <button type="button" onClick={onEnterPreview}>
          Continue in local preview
        </button>
        <button type="button" disabled>
          Matrix sign in coming next
        </button>
      </div>
    </section>
  );
}
