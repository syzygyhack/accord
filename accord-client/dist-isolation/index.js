// Tauri Isolation Hook
// Intercepts all IPC messages before they reach Tauri Core.
// Runs in a sandboxed iframe with AES-GCM encryption per session.

window.__TAURI_ISOLATION_HOOK__ = (payload) => {
  // Block filesystem access outside app directories.
  // Only $APPDATA and $APPCACHE are permitted.
  if (payload.cmd && payload.cmd.startsWith('plugin:fs|')) {
    const path = (payload.args && payload.args.path) || '';
    if (
      typeof path === 'string' &&
      path.length > 0 &&
      !path.startsWith('$APPDATA') &&
      !path.startsWith('$APPCACHE') &&
      !path.startsWith('$DOWNLOAD')
    ) {
      return null;
    }
  }

  // Block shell/process execution — accord should never spawn processes from the frontend.
  if (payload.cmd && payload.cmd.startsWith('plugin:shell|')) {
    return null;
  }

  return payload;
};
