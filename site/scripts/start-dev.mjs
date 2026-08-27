/**
 * Local dev entry: API on :3001 (if not already up) + CRA webpack-dev-server.
 * `npm start --prefix site` is the documented way to run the app, and auth
 * callback / /api/me both need the API process.
 */
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function spawnInherit(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  children.push(child);
  return child;
}

function apiIsUp() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:3001/api/me', (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(400, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (!(await apiIsUp())) {
  console.log('Starting local API on http://localhost:3001');
  spawnInherit(process.execPath, [path.join(root, 'chat-dev-server.js')]);
} else {
  console.log('Local API already running on http://localhost:3001');
}

const reactScripts = path.join(root, 'node_modules', '.bin', 'react-scripts');
const cra = spawnInherit(reactScripts, ['start']);
cra.on('exit', (code, signal) => {
  shutdown();
  process.exit(code ?? (signal ? 1 : 0));
});
