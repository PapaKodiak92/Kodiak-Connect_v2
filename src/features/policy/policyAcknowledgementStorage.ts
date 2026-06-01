import { policyVersions } from './policyVersions';

const ACK_STORAGE_KEY_PREFIX = 'kodiak-connect-v2:official-space-ack';

export interface OfficialSpaceAcknowledgementRecord {
  acknowledgedAt: string;
  officialSpaceRulesVersion: string;
  privacyVersion: string;
  safetyVersion: string;
  termsVersion: string;
  userId: string;
}

function getStorageKey(userId: string) {
  return `${ACK_STORAGE_KEY_PREFIX}:${userId}`;
}

function isCurrentAcknowledgement(record: Partial<OfficialSpaceAcknowledgementRecord> | null, userId: string) {
  return Boolean(
    record &&
      record.userId === userId &&
      record.officialSpaceRulesVersion === policyVersions.officialSpaceRules &&
      record.termsVersion === policyVersions.terms &&
      record.privacyVersion === policyVersions.privacy &&
      record.safetyVersion === policyVersions.safety,
  );
}

export function hasCurrentOfficialSpaceAcknowledgement(userId: string) {
  const rawRecord = window.localStorage.getItem(getStorageKey(userId));

  if (!rawRecord) {
    return false;
  }

  try {
    const record = JSON.parse(rawRecord) as Partial<OfficialSpaceAcknowledgementRecord>;
    return isCurrentAcknowledgement(record, userId);
  } catch (error) {
    console.error('[Kodiak Connect] Failed to read acknowledgement record', error);
    window.localStorage.removeItem(getStorageKey(userId));
    return false;
  }
}

export function saveOfficialSpaceAcknowledgement(userId: string) {
  const record: OfficialSpaceAcknowledgementRecord = {
    acknowledgedAt: new Date().toISOString(),
    officialSpaceRulesVersion: policyVersions.officialSpaceRules,
    termsVersion: policyVersions.terms,
    privacyVersion: policyVersions.privacy,
    safetyVersion: policyVersions.safety,
    userId,
  };

  window.localStorage.setItem(getStorageKey(userId), JSON.stringify(record));
  return record;
}
