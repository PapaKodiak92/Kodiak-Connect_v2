import { useMemo, useState } from 'react';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';
import { ChannelSidebar } from './ChannelSidebar';
import { ChatPlaceholder } from './ChatPlaceholder';
import { ServerRail } from './ServerRail';
import { officialSpace } from './workspaceData';
import type { WorkspaceChannel, WorkspaceSpace } from './workspaceTypes';

interface WorkspaceShellProps {
  identity: MatrixLoginIdentity;
  onLogout: () => void;
}

const spaces: WorkspaceSpace[] = [officialSpace];

function findInitialChannel(space: WorkspaceSpace) {
  return space.sections.flatMap((section) => section.channels).find((channel) => !channel.disabled) ?? space.sections[0]?.channels[0];
}

export function WorkspaceShell({ identity, onLogout }: WorkspaceShellProps) {
  const [activeSpaceId, setActiveSpaceId] = useState(officialSpace.id);
  const [activeChannelId, setActiveChannelId] = useState('general');

  const activeSpace = useMemo(() => spaces.find((space) => space.id === activeSpaceId) ?? officialSpace, [activeSpaceId]);
  const activeChannel = useMemo(() => {
    return activeSpace.sections.flatMap((section) => section.channels).find((channel) => channel.id === activeChannelId) ?? findInitialChannel(activeSpace);
  }, [activeChannelId, activeSpace]);

  function handleSelectSpace(spaceId: string) {
    const nextSpace = spaces.find((space) => space.id === spaceId);

    if (!nextSpace) {
      return;
    }

    setActiveSpaceId(spaceId);

    const firstChannel = findInitialChannel(nextSpace);
    if (firstChannel) {
      setActiveChannelId(firstChannel.id);
    }
  }

  function handleSelectChannel(channel: WorkspaceChannel) {
    if (channel.disabled) {
      return;
    }

    setActiveChannelId(channel.id);
  }

  if (!activeChannel) {
    return null;
  }

  return (
    <main className="workspace-app-shell">
      <ServerRail spaces={spaces} activeSpaceId={activeSpace.id} onSelectSpace={handleSelectSpace} />
      <ChannelSidebar activeSpace={activeSpace} activeChannelId={activeChannel.id} onSelectChannel={handleSelectChannel} onLogout={onLogout} />
      <ChatPlaceholder activeSpace={activeSpace} activeChannel={activeChannel} identity={identity} />
    </main>
  );
}
