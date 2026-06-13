import { spawnSync } from 'node:child_process';

const requestedTarget = process.argv[2] ?? 'web';

function resolveDesktopTarget() {
  switch (process.platform) {
    case 'win32':
      return 'desktop-windows';
    case 'linux':
      return 'desktop-linux';
    case 'darwin':
      return 'desktop-macos';
    default:
      return 'desktop-unknown';
  }
}

function resolveBuildTarget(target) {
  if (target === 'desktop' || target === 'desktop-auto') {
    return resolveDesktopTarget();
  }

  const allowedTargets = new Set([
    'web',
    'android',
    'desktop-windows',
    'desktop-linux',
    'desktop-macos',
    'desktop-unknown',
  ]);

  if (!allowedTargets.has(target)) {
    throw new Error(
      `Unknown Kodiak frontend build target "${target}". Use web, android, desktop, desktop-windows, desktop-linux, or desktop-macos.`
    );
  }

  return target;
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const buildTarget = resolveBuildTarget(requestedTarget);
const env = {
  ...process.env,
  KODIAK_BUILD_TARGET: buildTarget,
  VITE_KODIAK_BUILD_TARGET: buildTarget,
};

console.log(`[Kodiak Connect] Building frontend target: ${buildTarget}`);
run('tsc', ['-b'], env);
run('vite', ['build'], env);
