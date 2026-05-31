export type ChannelKind = 'announcement' | 'text' | 'safety' | 'family' | 'business';

export interface WorkspaceChannel {
  id: string;
  name: string;
  kind: ChannelKind;
  description: string;
  disabled?: boolean;
  matrixAlias?: string;
  readOnly?: boolean;
  allowedPosterIds?: string[];
}

export interface WorkspaceChannelSection {
  id: string;
  title: string;
  channels: WorkspaceChannel[];
}

export interface WorkspaceSpace {
  id: string;
  name: string;
  description: string;
  iconSrc: string;
  sections: WorkspaceChannelSection[];
}
