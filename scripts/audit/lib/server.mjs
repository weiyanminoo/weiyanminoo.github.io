// Starts and stops a real `astro preview` server over the already-built
// dist/, and tears it down deterministically (including on Windows, where a
// plain child.kill() does not reliably reach the whole process tree).

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const astroBin = path.join(repoRoot, 'node_modules', 'astro', 'bin', 'astro.mjs');

async function waitForReady(url, child, getOutput, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });

  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(
        `astro preview exited before it became ready.\n--- server output ---\n${getOutput()}`
      );
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok || res.status === 404) {
        // Any response at all means the HTTP server is up; 404 would only
        // happen for an unrelated path, not `/`.
        return;
      }
    } catch {
      // Not up yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `Timed out waiting for astro preview at ${url}.\n--- server output ---\n${getOutput()}`
  );
}

function killWindowsTree(pid) {
  spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

/**
 * Starts `astro preview` over dist/ on `port` and resolves once it responds
 * to HTTP requests. Throws (with captured server output) if it never comes
 * up. Caller must call `stop()` in a `finally`, whether or not checks pass.
 */
export async function startServer(port) {
  const child = spawn(
    process.execPath,
    [astroBin, 'preview', '--port', String(port), '--host', '127.0.0.1', '--ignore-lock'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] }
  );

  let output = '';
  child.stdout.on('data', (d) => {
    output += d.toString();
  });
  child.stderr.on('data', (d) => {
    output += d.toString();
  });

  const url = `http://127.0.0.1:${port}`;

  try {
    await waitForReady(url, child, () => output, 20_000);
  } catch (err) {
    await stopServer(child);
    throw err;
  }

  return { url, child };
}

export async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (process.platform === 'win32') {
    killWindowsTree(child.pid);
  } else {
    child.kill('SIGTERM');
  }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  if (child.exitCode === null && child.signalCode === null) {
    // Last resort: still alive after the grace period.
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }
}
