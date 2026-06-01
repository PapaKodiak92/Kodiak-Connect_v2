import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';
import {
  addKodiakReportNote,
  archiveKodiakReport,
  deleteKodiakReport,
  loadKodiakReports,
  replyToKodiakReport,
  updateKodiakReportStatus,
  type KodiakReport,
  type KodiakReportAction,
  type KodiakReportStatus,
} from '../backend/kodiakApiClient';
import type { WorkspaceChannel, WorkspaceSpace } from './workspaceTypes';

interface ChatPlaceholderProps {
  activeChannel: WorkspaceChannel;
  activeSpace: WorkspaceSpace;
  identity: MatrixLoginIdentity;
}

const PLATFORM_MODERATOR_IDS = ['@papakodiak:v2.kodiak-connect.com'];

type ReportComposerMode = 'reply' | 'note' | 'close' | 'dismiss' | 'reopen' | 'archive' | 'delete';

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
    return 'Closed';
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

function getActionLabel(action: KodiakReportAction) {
  if (action.type === 'reply') {
    return 'Reply';
  }

  if (action.type === 'note') {
    return 'Private note';
  }

  if (action.type === 'archive') {
    return 'Archived';
  }

  if (action.type === 'delete') {
    return 'Deleted';
  }

  const nextStatus = action.toStatus ? getReportStatusLabel(action.toStatus) : 'Updated';
  return `Status: ${nextStatus}`;
}

function isPlatformModerator(userId: string) {
  return PLATFORM_MODERATOR_IDS.includes(userId);
}

function getComposerPlaceholder(mode: ReportComposerMode) {
  if (mode === 'reply') {
    return 'Write a reply in this report thread...';
  }

  if (mode === 'note') {
    return 'Add an internal moderator note...';
  }

  if (mode === 'close') {
    return 'Optional closing note visible to the reporter...';
  }

  if (mode === 'dismiss') {
    return 'Optional dismissal reason visible to the reporter...';
  }

  if (mode === 'archive') {
    return 'Optional internal archive note...';
  }

  if (mode === 'delete') {
    return 'Optional. Deleting permanently removes this report from the local report store.';
  }

  return 'Optional reopen note visible to the reporter...';
}

function getComposerTitle(mode: ReportComposerMode) {
  if (mode === 'reply') return 'Reply to report';
  if (mode === 'note') return 'Add private note';
  if (mode === 'close') return 'Close report';
  if (mode === 'dismiss') return 'Dismiss report';
  if (mode === 'archive') return 'Archive report';
  if (mode === 'delete') return 'Delete report';
  return 'Reopen report';
}

function getStatusFromComposerMode(mode: ReportComposerMode): KodiakReportStatus | null {
  if (mode === 'close') return 'reviewed';
  if (mode === 'dismiss') return 'dismissed';
  if (mode === 'reopen') return 'open';
  return null;
}

function upsertReport(reports: KodiakReport[], updatedReport: KodiakReport) {
  const exists = reports.some((report) => report.id === updatedReport.id);
  const nextReports = exists
    ? reports.map((report) => (report.id === updatedReport.id ? updatedReport : report))
    : [updatedReport, ...reports];

  return nextReports.sort((a, b) => Number(b.updatedAt ?? b.createdAt ?? 0) - Number(a.updatedAt ?? a.createdAt ?? 0));
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
  const [activeReportAction, setActiveReportAction] = useState<{ mode: ReportComposerMode; reportId: string } | null>(null);
  const [actionDraft, setActionDraft] = useState('');
  const [actionErrorText, setActionErrorText] = useState<string | null>(null);
  const [actionSuccessText, setActionSuccessText] = useState<string | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
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

  function beginReportAction(reportId: string, mode: ReportComposerMode) {
    setActiveReportAction({ mode, reportId });
    setActionDraft('');
    setActionErrorText(null);
    setActionSuccessText(null);
  }

  function cancelReportAction() {
    setActiveReportAction(null);
    setActionDraft('');
    setActionErrorText(null);
  }

  async function handleSubmitReportAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeReportAction) {
      return;
    }

    const trimmedDraft = actionDraft.trim();

    if ((activeReportAction.mode === 'reply' || activeReportAction.mode === 'note') && trimmedDraft.length < 2) {
      setActionErrorText('Add at least a short message before submitting.');
      return;
    }

    setIsSubmittingAction(true);
    setActionErrorText(null);
    setActionSuccessText(null);

    try {
      let updatedReport: KodiakReport | null = null;
      const nextStatus = getStatusFromComposerMode(activeReportAction.mode);

      if (activeReportAction.mode === 'reply') {
        updatedReport = await replyToKodiakReport(identity, activeReportAction.reportId, trimmedDraft);
      } else if (activeReportAction.mode === 'note') {
        updatedReport = await addKodiakReportNote(identity, activeReportAction.reportId, trimmedDraft);
      } else if (activeReportAction.mode === 'archive') {
        updatedReport = await archiveKodiakReport(identity, activeReportAction.reportId, trimmedDraft);
      } else if (activeReportAction.mode === 'delete') {
        await deleteKodiakReport(identity, activeReportAction.reportId);
        setReports((currentReports) => currentReports.filter((report) => report.id !== activeReportAction.reportId));
      } else if (nextStatus) {
        updatedReport = await updateKodiakReportStatus(identity, activeReportAction.reportId, nextStatus, trimmedDraft);
      }

      if (updatedReport) {
        if (updatedReport.archivedAt) {
          setReports((currentReports) => currentReports.filter((report) => report.id !== updatedReport?.id));
        } else {
          setReports((currentReports) => upsertReport(currentReports, updatedReport as KodiakReport));
        }
      }

      setActionSuccessText(
        activeReportAction.mode === 'archive'
          ? 'Report archived.'
          : activeReportAction.mode === 'delete'
            ? 'Report deleted.'
            : 'Report updated.',
      );
      cancelReportAction();
    } catch (error) {
      console.error('[Kodiak Connect] Failed to handle report', error);
      setActionErrorText(error instanceof Error ? error.message : 'Could not update report. Try again.');
    } finally {
      setIsSubmittingAction(false);
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
              ? 'Moderator view is enabled. Reply, add notes, close, dismiss, archive, or delete reports.'
              : 'This view shows your reports. You can reply in the report thread when a moderator responds.'}
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
          <span>Closed</span>
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

      {actionErrorText ? (
        <div className="matrix-chat-status matrix-chat-status--error">
          <span className="status-light status-light--offline" aria-hidden="true" />
          <span>{actionErrorText}</span>
        </div>
      ) : null}

      {actionSuccessText ? (
        <div className="matrix-chat-status">
          <span className="status-light status-light--online" aria-hidden="true" />
          <span>{actionSuccessText}</span>
        </div>
      ) : null}

      {isLoadingReports ? <div className="matrix-empty-state">Loading Safety Center reports...</div> : null}

      {!isLoadingReports && !reports.length && !reportsErrorText ? (
        <div className="matrix-empty-state">
          {canReviewAllReports ? 'No active reports are waiting for review.' : 'You have not submitted any active reports.'}
        </div>
      ) : null}

      {!isLoadingReports && reports.length ? (
        <div className="safety-report-list" aria-label="Submitted reports">
          {reports.map((report) => {
            const activeActionForReport = activeReportAction?.reportId === report.id ? activeReportAction.mode : null;

            return (
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

                {report.actions?.length ? (
                  <div className="safety-report-history" aria-label="Report history">
                    <h4>History</h4>
                    {report.actions.map((action) => (
                      <article className={`safety-report-action safety-report-action--${action.type}`} key={action.id}>
                        <header>
                          <strong>{getActionLabel(action)}</strong>
                          <time dateTime={new Date(action.createdAt).toISOString()}>{formatReportDate(action.createdAt)}</time>
                        </header>
                        <p>{action.body}</p>
                        <small>
                          {getDisplayName(action.actorUserId)}
                          {action.type === 'note' ? ' · internal only' : ''}
                        </small>
                      </article>
                    ))}
                  </div>
                ) : null}

                <div className="safety-report-controls" aria-label="Report actions">
                  <button type="button" onClick={() => beginReportAction(report.id, 'reply')}>Reply</button>
                  {canReviewAllReports ? (
                    <>
                      <button type="button" onClick={() => beginReportAction(report.id, 'note')}>Private note</button>
                      {report.status !== 'reviewed' ? (
                        <button type="button" onClick={() => beginReportAction(report.id, 'close')}>Close</button>
                      ) : null}
                      {report.status !== 'dismissed' ? (
                        <button type="button" onClick={() => beginReportAction(report.id, 'dismiss')}>Dismiss</button>
                      ) : null}
                      {report.status !== 'open' ? (
                        <button type="button" onClick={() => beginReportAction(report.id, 'reopen')}>Reopen</button>
                      ) : null}
                      <button type="button" onClick={() => beginReportAction(report.id, 'archive')}>Archive</button>
                      <button className="safety-report-control--danger" type="button" onClick={() => beginReportAction(report.id, 'delete')}>Delete</button>
                    </>
                  ) : null}
                </div>

                {activeActionForReport ? (
                  <form className="safety-report-composer" onSubmit={handleSubmitReportAction}>
                    <label>
                      <span>{getComposerTitle(activeActionForReport)}</span>
                      <textarea
                        value={actionDraft}
                        onChange={(event) => setActionDraft(event.target.value)}
                        placeholder={getComposerPlaceholder(activeActionForReport)}
                        rows={4}
                      />
                    </label>
                    <div>
                      <button type="button" onClick={cancelReportAction} disabled={isSubmittingAction}>Cancel</button>
                      <button
                        className={activeActionForReport === 'delete' ? 'safety-report-control--danger' : undefined}
                        type="submit"
                        disabled={isSubmittingAction}
                      >
                        {isSubmittingAction
                          ? 'Saving...'
                          : activeActionForReport === 'delete'
                            ? 'Delete permanently'
                            : 'Save action'}
                      </button>
                    </div>
                  </form>
                ) : null}

                <footer>
                  <span>Report ID: {report.id}</span>
                  {report.messageEventId ? <span>Message: {report.messageEventId}</span> : null}
                </footer>
              </article>
            );
          })}
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
