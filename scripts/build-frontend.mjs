import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requestedTarget = process.argv[2] ?? 'web';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
    'desktop-linux-electron',
    'desktop-macos',
    'desktop-unknown',
  ]);

  if (!allowedTargets.has(target)) {
    throw new Error(
      `Unknown Kodiak frontend build target "${target}". Use web, android, desktop, desktop-windows, desktop-linux, desktop-linux-electron, or desktop-macos.`
    );
  }

  return target;
}

function runNodeTool(relativeToolPath, args, env) {
  const toolPath = path.join(repoRoot, ...relativeToolPath);
  const result = spawnSync(process.execPath, [toolPath, ...args], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
    shell: false,
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
runNodeTool(['node_modules', 'typescript', 'bin', 'tsc'], ['-b'], env);
runNodeTool(['node_modules', 'vite', 'bin', 'vite.js'], ['build'], env);
