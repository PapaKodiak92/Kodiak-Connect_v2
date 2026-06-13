import { policyVersions } from './policyVersions';

interface OfficialSpaceAcknowledgementModalProps {
  onAcknowledge: () => void;
}

export function OfficialSpaceAcknowledgementModal({ onAcknowledge }: OfficialSpaceAcknowledgementModalProps) {
  return (
    <div className="policy-modal-backdrop" role="presentation">
      <section className="policy-modal" role="dialog" aria-modal="true" aria-labelledby="official-space-rules-title">
        <div className="policy-modal__brand">
          <div className="brand-orb">
            <img src="kodiak-connect-icon.png" alt="" />
          </div>

          <div>
            <p className="eyebrow eyebrow--ember">Official Space Rules</p>
            <h1 id="official-space-rules-title">Welcome to Kodiak Connect.</h1>
            <p>
              Before entering Official Space, acknowledge the core safety rules that apply across the platform.
            </p>
          </div>
        </div>

        <div className="policy-modal__content">
          <ul>
            <li>You agree to follow Kodiak Connect rules and community expectations.</li>
            <li>Platform safety rules apply to everyone. No account type gives immunity.</li>
            <li>Server owners, parents/guardians, business owners, moderators, and premium users can still face enforcement.</li>
            <li>Serious safety concerns may be reviewed by Kodiak Trust & Safety.</li>
            <li>Reports and red-flag incidents may be preserved and escalated when required.</li>
            <li>Terms, privacy, and safety policies are still drafts during production and must be legally reviewed before public launch.</li>
          </ul>
        </div>

        <div className="policy-modal__versions" aria-label="Policy versions">
          <span>Rules: {policyVersions.officialSpaceRules}</span>
          <span>Terms: {policyVersions.terms}</span>
          <span>Privacy: {policyVersions.privacy}</span>
          <span>Safety: {policyVersions.safety}</span>
        </div>

        <div className="policy-modal__actions">
          <button type="button" className="button-primary" onClick={onAcknowledge}>
            I Acknowledge
          </button>
        </div>
      </section>
    </div>
  );
}
