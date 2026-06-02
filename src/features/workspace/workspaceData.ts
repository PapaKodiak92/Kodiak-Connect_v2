import type { WorkspaceSpace } from './workspaceTypes';

export const officialSpace: WorkspaceSpace = {
  id: 'official-space',
  name: 'Official Space',
  description: 'The official Kodiak Connect starting space for updates, safety, and community direction.',
  iconSrc: '/kodiak-connect-icon.png',
  sections: [
    {
      id: 'official',
      title: 'Official',
      channels: [
        {
          id: 'announcements',
          name: 'announcements',
          kind: 'announcement',
          description: 'Major Kodiak Connect announcements, safety notices, policy updates, and launch notices.',
          matrixAlias: '#announcements:kodiak-connect.com',
          readOnly: true,
          allowedPosterIds: ['@papakodiak:kodiak-connect.com'],
        },
        {
          id: 'dev-updates',
          name: 'dev-updates',
          kind: 'announcement',
          description: 'Official Kodiak Connect development updates and curated release notes.',
          matrixAlias: '#dev-updates:kodiak-connect.com',
          readOnly: true,
          allowedPosterIds: ['@papakodiak:kodiak-connect.com'],
        },
        {
          id: 'general',
          name: 'general',
          kind: 'text',
          description: 'The first public community channel for Kodiak Connect.',
          matrixAlias: '#general:kodiak-connect.com',
        },
      ],
    },
   {
      id: 'direct-messages',
      title: 'Direct Messages',
      channels: [
        {
          id: 'dm-kodiaktest',
          name: 'kodiaktest',
          kind: 'dm',
          description: 'Private direct message with kodiaktest.',
          matrixDmUserId: '@kodiaktest:kodiak-connect.com',
          dmDisplayName: 'kodiaktest',
        },
      ],
    },
    {
      id: 'safety',
      title: 'Safety',
      channels: [
        {
          id: 'safety-center',
          name: 'safety-center',
          kind: 'safety',
          description: 'Report issues, review safety guidance, and learn how Kodiak protects users.',
        },
        {
          id: 'trust-and-safety',
          name: 'trust-and-safety',
          kind: 'safety',
          description: 'Platform safety model placeholder. Full tooling comes later.',
          disabled: true,
        },
      ],
    },
    {
      id: 'account-types',
      title: 'Account Types',
      channels: [
        {
          id: 'family-center',
          name: 'family-center',
          kind: 'family',
          description: 'Family account and parent/guardian tools placeholder.',
          disabled: true,
        },
        {
          id: 'business-center',
          name: 'business-center',
          kind: 'business',
          description: 'Business workspace and server owner tools placeholder.',
          disabled: true,
        },
      ],
    },
  ],
};
