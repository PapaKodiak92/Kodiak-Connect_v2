export type KodiakResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West';

export async function beginWindowMove() {
  const windowApi = await import('@tauri-apps/api/window');
  await windowApi.getCurrentWindow().startDragging();
}

export async function beginWindowResize(direction: KodiakResizeDirection) {
  const windowApi = (await import('@tauri-apps/api/window')) as unknown as {
    getCurrentWindow: () => {
      startResizeDragging?: (resizeDirection: unknown) => Promise<void>;
    };
    ResizeDirection?: Record<string, unknown>;
  };

  const appWindow = windowApi.getCurrentWindow();
  const resizeDirection = windowApi.ResizeDirection?.[direction] ?? direction;

  if (typeof appWindow.startResizeDragging !== 'function') {
    return;
  }

  await appWindow.startResizeDragging(resizeDirection);
}

export async function minimizeWindow() {
  const windowApi = await import('@tauri-apps/api/window');
  await windowApi.getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow() {
  const windowApi = await import('@tauri-apps/api/window');
  const appWindow = windowApi.getCurrentWindow();

  if (await appWindow.isMaximized()) {
    await appWindow.unmaximize();
    return;
  }

  await appWindow.maximize();
}

export async function closeWindow() {
  const windowApi = await import('@tauri-apps/api/window');
  await windowApi.getCurrentWindow().close();
}