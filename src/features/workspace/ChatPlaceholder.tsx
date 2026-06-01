import { useEffect, useMemo, useState } from 'react';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';
import { loadKodiakReports, type KodiakReport } from '../backend/kodiakApiClient';
import type { WorkspaceChannel, WorkspaceSpace } from './workspaceTypes';

interface ChatPlaceholderProps {
  activeChannel: WorkspaceChannel;
  activeSpace: WorkspaceSpace;
  identity: MatrixLoginIdentity;
}

const PLATFORM_MODERATOR_IDS = ['@papakodiak:v2.kodiak-connect.com'];

function getDisplayName(userId: string) {
  const withoutPrefix = userId.startsWith('@') ? userId.slice(1) : userId;
  return withoutPrefix.split(':')[0] || userId;
}

function formatReportDate(timestamp: number) {
  if (!timestamp) {
    return 'Unknown time';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function getReportStatusLabel(status: KodiakReport['status']) {
  if (status === 'reviewed') {
    return 'Reviewed';
  }

  if (status === 'dismissed') {
    return 'Dismissed';
  }

  return 'Open';
}

function getReportCategoryLabel(category: KodiakReport['category']) {
  return category
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function isPlatformModerator(userId: string) {
  return PLATFORM_MODERATOR_IDS.includes(userId);
}

function getChannelEmptyState(channel: WorkspaceChannel) {
  if (channel.id === 'general') {
    return {
      title: 'Welcome to Kodiak Connect.',
      body: 'This is the first Official Space shell. Real Matrix room sync, message history, sending, and moderation hooks come next.',
      showPillGrid: true,
    };
  }

  if (channel.id === 'announcements') {
    return {
      title: 'No announcements yet.',
      body: 'Official launch notes, product updates, and platform notices will appear here.',
      showPillGrid: false,
    };
  }

  if (channel.id === 'dev-updates') {
    return {
      title: 'Development updates will live here.',
      body: 'This channel will track build progress, release notes, and roadmap checkpoints.',
      showPillGrid: false,
    };
  }

  if (channel.id === 'safety-center') {
    return {
      title: 'Safety Center is being prepared.',
      body: 'Reports, safety guidance, family protection, business moderation, and Trust & Safety resources will be organized here.',
      showPillGrid: true,
    };
  }

  return {
    title: `#${channel.name} is not connected yet.`,
    body: 'This channel exists in the app shell, but Matrix room sync has not been wired yet.',
    showPillGrid: false,
  };
}

function SafetyCenterReports({ identity }: Pick<ChatPlaceholderProps, 'identity'>) {
  const [reports, setReports] = useState<KodiakReport[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(true);
  const [reportsErrorText, setReportsErrorText] = useState<string | null>(null);
  const canReviewAllReports = isPlatformModerator(identity.userId);

  const reportCounts = useMemo(() => {
    return reports.reduce(
      (counts, report) => {
        counts.total += 1;
        counts[report.status] += 1;
        return counts;
      },
      { dismissed: 0, open: 0, reviewed: 0, total: 0 },
    );
  }, [reports]);

  async function refreshReports() {
    setIsLoadingReports(true);
    setReportsErrorText(null);

    try {
      const loadedReports = await loadKodiakReports(identity);
      setReports(loadedReports);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to load Safety Center reports', error);
      setReportsErrorText(error instanceof Error ? error.message : 'Could not load reports. Make sure the Kodiak backend is running.');
    } finally {
      setIsLoadingReports(false);
    }
  }

  useEffect(() => {
    void refreshReports();
  }, [identity]);

  return (
    <div className="safety-center-panel">
      <section className="safety-center-hero" aria-label="Safety Center overview">
        <div>
          <p className="eyebrow eyebrow--ember">Trust & Safety</p>
          <h2>Report review is online.</h2>
          <p>
            {canReviewAllReports
              ? 'Moderator view is enabled. You can see reports submitted across Kodiak Connect.'
              : 'This view shows reports you submitted to Kodiak Trust & Safety.'}
          </p>
        </div>

        <button type="button" onClick={refreshReports} disabled={isLoadingReports}>
          {isLoadingReports ? 'Refreshing...' : 'Refresh reports'}
        </button>
      </section>

      <div className="safety-center-stats" aria-label="Report totals">
        <div>
          <strong>{reportCounts.total}</strong>
          <span>Total</span>
        </div>
        <div>
          <strong>{reportCounts.open}</strong>
          <span>Open</span>
        </div>
        <div>
          <strong>{reportCounts.reviewed}</strong>
          <span>Reviewed</span>
        </div>
        <div>
          <strong>{reportCounts.dismissed}</strong>
          <span>Dismissed</span>
        </div>
      </div>

      {reportsErrorText ? (
        <div className="matrix-chat-status matrix-chat-status--error">
          <span className="status-light status-light--offline" aria-hidden="true" />
          <span>{reportsErrorText}</span>
        </div>
      ) : null}

      {isLoadingReports ? <div className="matrix-empty-state">Loading Safety Center reports...</div> : null}

      {!isLoadingReports && !reports.length && !reportsErrorText ? (
        <div className="matrix-empty-state">
          {canReviewAllReports ? 'No reports have been submitted yet.' : 'You have not submitted any reports yet.'}
        </div>
      ) : null}

      {!isLoadingReports && reports.length ? (
        <div className="safety-report-list" aria-label="Submitted reports">
          {reports.map((report) => (
            <article className="safety-report-card" key={report.id}>
              <header>
                <div>
                  <p className="eyebrow eyebrow--ember">{getReportCategoryLabel(report.category)}</p>
                  <h3>{report.targetDisplayName || getDisplayName(report.targetUserId)}</h3>
                </div>
                <span className={`safety-report-status safety-report-status--${report.status}`}>
                  {getReportStatusLabel(report.status)}
                </span>
              </header>

              <dl className="safety-report-meta">
                <div>
                  <dt>Reporter</dt>
                  <dd>{getDisplayName(report.reporterUserId)}</dd>
                </div>
                <div>
                  <dt>Target</dt>
                  <dd>{report.targetUserId}</dd>
                </div>
                <div>
                  <dt>Context</dt>
                  <dd>{report.context || report.roomId || 'No context provided'}</dd>
                </div>
                <div>
                  <dt>Submitted</dt>
                  <dd>{formatReportDate(report.createdAt)}</dd>
                </div>
              </dl>

              <p>{report.details}</p>

              <footer>
                <span>Report ID: {report.id}</span>
                {report.messageEventId ? <span>Message: {report.messageEventId}</span> : null}
              </footer>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ChatPlaceholder({ activeChannel, activeSpace, identity }: ChatPlaceholderProps) {
  const displayName = getDisplayName(identity.userId);
  const emptyState = getChannelEmptyState(activeChannel);

  return (
    <section className="chat-placeholder" aria-label={`${activeChannel.name} channel`}>
      <header className="chat-placeholder__header">
        <div>
          <p className="eyebrow eyebrow--ember">{activeSpace.name}</p>
          <h1>#{activeChannel.name}</h1>
          <p>{activeChannel.description}</p>
        </div>

        <div className="chat-placeholder__user">
          <span className="status-light status-light--online" aria-hidden="true" />
          <span>{displayName}</span>
        </div>
      </header>

      <div className="chat-placeholder__body">
        {activeChannel.id === 'safety-center' ? (
          <SafetyCenterReports identity={identity} />
        ) : (
          <>
            <article className={`welcome-message ${activeChannel.id === 'general' ? '' : 'welcome-message--compact'}`}>
              <div className="brand-orb">
                <img src="/kodiak-connect-icon.png" alt="" />
              </div>

              <div>
                <h2>{emptyState.title}</h2>
                <p>{emptyState.body}</p>
              </div>
            </article>

            {emptyState.showPillGrid ? (
              <div className="workspace-pill-grid" aria-label="Product pillars">
                <div>
                  <strong>Individual</strong>
                  <span>Private, secure communication.</span>
                </div>
                <div>
                  <strong>Family</strong>
                  <span>Parent/guardian tools with clear limits.</span>
                </div>
                <div>
                  <strong>Business</strong>
                  <span>Owned spaces, channels, roles, and safety.</span>
                </div>
                <div>
                  <strong>Trust & Safety</strong>
                  <span>Platform-level review. No role gives immunity.</span>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <footer className="message-composer-placeholder">
        <input type="text" placeholder="Message composer coming soon" disabled />
        <button type="button" disabled>
          Send
        </button>
      </footer>
    </section>
  );
}
