import type { ReactNode } from 'react';

interface KodiakStatusCardProps {
  eyebrow: string;
  title: string;
  description?: string;
  statusText: string;
  detailText?: string | null;
  badgeText?: string;
  tone?: 'ready' | 'available' | 'working' | 'error';
  showIcon?: boolean;
  children?: ReactNode;
}

export function KodiakStatusCard({
  eyebrow,
  title,
  description,
  statusText,
  detailText,
  badgeText,
  tone = 'ready',
  showIcon = true,
  children,
}: KodiakStatusCardProps) {
  const titleId = `${title.replace(/\s+/g, '-').toLowerCase()}-title`;

  return (
    <section className={`kodiak-status-card kodiak-status-card--${tone}`} aria-labelledby={titleId}>
      <div className="kodiak-status-card__header">
        {showIcon ? (
          <div className="brand-orb" aria-hidden="true">
            <img src="kodiak-connect-icon.png" alt="" />
          </div>
        ) : null}
        <div>
          <p className="eyebrow eyebrow--ember">{eyebrow}</p>
          <h2 id={titleId}>{title}</h2>
          {description ? <p className="kodiak-status-card__description">{description}</p> : null}
        </div>
        {badgeText ? <span className="kodiak-badge">{badgeText}</span> : null}
      </div>

      <div className="kodiak-status-card__status">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <p>{statusText}</p>
          {detailText ? <p className="muted-text">{detailText}</p> : null}
        </div>
      </div>

      {children ? <div className="kodiak-status-card__actions">{children}</div> : null}
    </section>
  );
}
