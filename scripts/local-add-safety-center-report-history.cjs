const fs = require("fs");

/* -------------------------------------------------------------------------- */
/* Safety Center Report History v1                                            */
/* -------------------------------------------------------------------------- */

const panelFile = "src/features/workspace/MatrixChannelPanel.tsx";
let text = fs.readFileSync(panelFile, "utf8");

function insertBeforeNeedle(source, needle, insertion) {
  const index = source.indexOf(needle);
  if (index === -1) {
    throw new Error(`Could not find needle: ${needle}`);
  }
  return source.slice(0, index) + insertion + source.slice(index);
}

function insertAfterNeedle(source, needle, insertion) {
  const index = source.indexOf(needle);
  if (index === -1) {
    throw new Error(`Could not find needle: ${needle}`);
  }
  return source.slice(0, index + needle.length) + insertion + source.slice(index + needle.length);
}

function replaceOnce(source, search, replacement) {
  if (!source.includes(search)) {
    throw new Error(`Could not find replacement target: ${search.slice(0, 120)}`);
  }
  return source.replace(search, replacement);
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

if (!text.includes("loadKodiakReports")) {
  text = text.replace(
    `  loadKodiakProfiles,`,
    `  loadKodiakProfiles,
  loadKodiakReports,`
  );
}

if (!text.includes("type KodiakReport,")) {
  text = text.replace(
    `  type KodiakPresenceState,`,
    `  type KodiakPresenceState,
  type KodiakReport,`
  );
}

// ---------------------------------------------------------------------------
// Utility label formatter
// ---------------------------------------------------------------------------

if (!text.includes("function getReportCategoryLabel")) {
  const utility = `
function getReportCategoryLabel(category: string) {
  switch (category) {
    case 'harassment':
      return 'Harassment or abuse';
    case 'spam':
      return 'Spam';
    case 'scam':
      return 'Scam or suspicious behavior';
    case 'threats':
      return 'Threats or safety concern';
    case 'impersonation':
      return 'Impersonation';
    default:
      return 'Other';
  }
}

`;

  text = insertBeforeNeedle(text, "export function MatrixChannelPanel({", utility);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

if (!text.includes("isSafetyCenterOpen")) {
  text = text.replace(
    `  const [reportSuccessText, setReportSuccessText] = useState<string | null>(null);`,
    `  const [reportSuccessText, setReportSuccessText] = useState<string | null>(null);
  const [isSafetyCenterOpen, setIsSafetyCenterOpen] = useState(false);
  const [safetyReports, setSafetyReports] = useState<KodiakReport[]>([]);
  const [isLoadingSafetyReports, setIsLoadingSafetyReports] = useState(false);
  const [safetyReportErrorText, setSafetyReportErrorText] = useState<string | null>(null);`
  );
}

// ---------------------------------------------------------------------------
// Safety Center handlers
// ---------------------------------------------------------------------------

if (!text.includes("async function refreshSafetyReports")) {
  const handlers = `  async function refreshSafetyReports() {
    setIsLoadingSafetyReports(true);
    setSafetyReportErrorText(null);

    try {
      const reports = await loadKodiakReports(identity);
      setSafetyReports(reports);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to load safety reports', error);
      setSafetyReportErrorText(error instanceof Error ? error.message : 'Could not load report history.');
    } finally {
      setIsLoadingSafetyReports(false);
    }
  }

  function openSafetyCenter() {
    setIsSafetyCenterOpen(true);
    void refreshSafetyReports();
  }

`;

  const insertionPoint = text.includes("  function requestReportUser(userId: string)")
    ? "  function requestReportUser(userId: string)"
    : "  function requestBlockUser(userId: string)";

  text = insertBeforeNeedle(text, insertionPoint, handlers);
}

// Refresh report history after submitting a report.
if (!text.includes("void refreshSafetyReports();\n      setReportSuccessText")) {
  text = text.replace(
    `      setReportSuccessText('Report submitted. Kodiak Trust & Safety can review it.');`,
    `      void refreshSafetyReports();
      setReportSuccessText('Report submitted. Kodiak Trust & Safety can review it.');`
  );
}

// ---------------------------------------------------------------------------
// Header button
// ---------------------------------------------------------------------------

if (!text.includes("openSafetyCenter")) {
  throw new Error("openSafetyCenter was not inserted correctly.");
}

if (!text.includes("Safety Center</span>")) {
  const userButtonNeedle = `        <button
          type="button"
          className="chat-placeholder__user chat-placeholder__user--button"
          onClick={() => {
            setDisplayNameDraft(getKnownDisplayName(identity.userId));`;

  const safetyButton = `        <button
          type="button"
          className="chat-placeholder__user chat-placeholder__user--button kodiak-safety-center-trigger"
          onClick={openSafetyCenter}
        >
          <span className="status-light status-light--idle" aria-hidden="true" />
          <span>Safety Center</span>
        </button>

`;

  text = insertBeforeNeedle(text, userButtonNeedle, safetyButton);
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

if (!text.includes("kodiak-safety-center-modal")) {
  const modal = `      {isSafetyCenterOpen ? (
        <div className="kodiak-modal-backdrop" role="presentation" onClick={() => setIsSafetyCenterOpen(false)}>
          <div
            className="kodiak-safety-center-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="safety-center-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="kodiak-safety-center-modal__close"
              aria-label="Close Safety Center"
              onClick={() => setIsSafetyCenterOpen(false)}
            >
              ×
            </button>

            <div className="kodiak-safety-center-modal__header">
              <p className="eyebrow eyebrow--ember">Trust & Safety</p>
              <h2 id="safety-center-title">Safety Center</h2>
              <p>View reports you have submitted. Admin review tools come later.</p>
            </div>

            <div className="kodiak-safety-center-modal__toolbar">
              <span>{safetyReports.length} submitted report{safetyReports.length === 1 ? '' : 's'}</span>
              <button type="button" onClick={() => void refreshSafetyReports()} disabled={isLoadingSafetyReports}>
                {isLoadingSafetyReports ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {safetyReportErrorText ? (
              <p className="kodiak-safety-center-modal__error" role="alert">
                {safetyReportErrorText}
              </p>
            ) : null}

            <div className="kodiak-safety-center-modal__body">
              {isLoadingSafetyReports && !safetyReports.length ? (
                <p className="kodiak-safety-center-empty">Loading report history...</p>
              ) : safetyReports.length ? (
                <div className="kodiak-safety-report-list">
                  {safetyReports.map((report) => (
                    <article key={report.id} className="kodiak-safety-report-card">
                      <div className="kodiak-safety-report-card__top">
                        <div>
                          <strong>{report.targetDisplayName || getKnownDisplayName(report.targetUserId)}</strong>
                          <span>{report.targetUserId}</span>
                        </div>
                        <em className="kodiak-safety-report-card__status">{report.status}</em>
                      </div>

                      <div className="kodiak-safety-report-card__meta">
                        <span>{getReportCategoryLabel(report.category)}</span>
                        <span>{new Date(report.createdAt).toLocaleString()}</span>
                      </div>

                      <p>{report.details}</p>

                      {report.context || report.roomId ? (
                        <small>
                          {report.context ? \`Context: \${report.context}\` : ''}
                          {report.context && report.roomId ? ' · ' : ''}
                          {report.roomId ? \`Room: \${report.roomId}\` : ''}
                        </small>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="kodiak-safety-center-empty">No submitted reports yet.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

`;

  const anchor = text.includes("      {isFriendCenterOpen ? (")
    ? "      {isFriendCenterOpen ? ("
    : "      {pendingBlockUserId ? (";

  text = insertBeforeNeedle(text, anchor, modal);
}

fs.writeFileSync(panelFile, text, "utf8");
console.log("Safety Center report history added to MatrixChannelPanel.");

/* -------------------------------------------------------------------------- */
/* CSS                                                                        */
/* -------------------------------------------------------------------------- */

const cssFile = "src/styles/matrix-chat.css";
let css = fs.readFileSync(cssFile, "utf8");

if (!css.includes(".kodiak-safety-center-modal")) {
  css += `

.kodiak-safety-center-trigger {
  min-width: max-content;
}

.kodiak-safety-center-modal {
  width: min(44rem, calc(100vw - 2rem));
  max-height: min(44rem, calc(100vh - 2rem));
  overflow: hidden;
  border: 1px solid rgba(251, 146, 60, 0.28);
  border-radius: 30px;
  background:
    radial-gradient(circle at 12% 0%, rgba(251, 146, 60, 0.14), transparent 34%),
    rgba(15, 23, 42, 0.98);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.56);
  display: grid;
  gap: 1rem;
  padding: 1.25rem;
  position: relative;
}

.kodiak-safety-center-modal__close {
  position: absolute;
  right: 1rem;
  top: 1rem;
  width: 2.15rem;
  height: 2.15rem;
  border: 1px solid rgba(251, 146, 60, 0.24);
  border-radius: 999px;
  background: rgba(2, 6, 23, 0.68);
  color: #fed7aa;
  cursor: pointer;
  font-size: 1.2rem;
  font-weight: 900;
}

.kodiak-safety-center-modal__header {
  display: grid;
  gap: 0.4rem;
  padding-right: 2.5rem;
}

.kodiak-safety-center-modal__header h2 {
  margin: 0;
  color: #fff7ed;
  font-size: 1.55rem;
  line-height: 1.1;
}

.kodiak-safety-center-modal__header p:last-child {
  margin: 0;
  color: #cbd5e1;
  line-height: 1.45;
}

.kodiak-safety-center-modal__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 18px;
  background: rgba(2, 6, 23, 0.36);
  padding: 0.75rem;
}

.kodiak-safety-center-modal__toolbar span {
  color: #fed7aa;
  font-size: 0.85rem;
  font-weight: 900;
}

.kodiak-safety-center-modal__toolbar button {
  border: 1px solid rgba(251, 146, 60, 0.24);
  border-radius: 999px;
  background: rgba(2, 6, 23, 0.58);
  color: #fed7aa;
  cursor: pointer;
  font-weight: 900;
  padding: 0.6rem 0.9rem;
}

.kodiak-safety-center-modal__toolbar button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.kodiak-safety-center-modal__body {
  min-height: 8rem;
  overflow: auto;
  padding-right: 0.15rem;
}

.kodiak-safety-report-list {
  display: grid;
  gap: 0.75rem;
}

.kodiak-safety-report-card {
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 20px;
  background: rgba(2, 6, 23, 0.46);
  display: grid;
  gap: 0.7rem;
  padding: 0.9rem;
}

.kodiak-safety-report-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
}

.kodiak-safety-report-card__top div {
  display: grid;
  min-width: 0;
  gap: 0.15rem;
}

.kodiak-safety-report-card__top strong {
  overflow: hidden;
  color: #fff7ed;
  font-size: 1rem;
  font-weight: 950;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kodiak-safety-report-card__top span,
.kodiak-safety-report-card small {
  color: #94a3b8;
  font-size: 0.78rem;
  font-weight: 800;
}

.kodiak-safety-report-card__status {
  border: 1px solid rgba(251, 146, 60, 0.24);
  border-radius: 999px;
  background: rgba(251, 146, 60, 0.1);
  color: #fed7aa;
  font-size: 0.72rem;
  font-style: normal;
  font-weight: 950;
  padding: 0.28rem 0.55rem;
  text-transform: uppercase;
}

.kodiak-safety-report-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.kodiak-safety-report-card__meta span {
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.52);
  color: #cbd5e1;
  font-size: 0.76rem;
  font-weight: 850;
  padding: 0.28rem 0.55rem;
}

.kodiak-safety-report-card p {
  margin: 0;
  color: #e2e8f0;
  line-height: 1.45;
}

.kodiak-safety-center-empty,
.kodiak-safety-center-modal__error {
  margin: 0;
  border-radius: 16px;
  font-size: 0.9rem;
  font-weight: 800;
  line-height: 1.35;
  padding: 0.85rem;
}

.kodiak-safety-center-empty {
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(2, 6, 23, 0.36);
  color: #cbd5e1;
}

.kodiak-safety-center-modal__error {
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: rgba(127, 29, 29, 0.26);
  color: #fecaca;
}
`;
}

fs.writeFileSync(cssFile, css, "utf8");
console.log("Safety Center report history styles added.");
console.log("Safety Center Report History v1 patch complete.");
