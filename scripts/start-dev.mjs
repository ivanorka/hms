import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const node = process.execPath;
const baseEnv = {
  ...process.env,
  DATABASE_FILENAME: '.tmp/data.db',
  XDG_CONFIG_HOME: path.join(root, 'backend', '.strapi-config'),
  STRAPI_TELEMETRY_DISABLED: 'true',
  STRAPI_DISABLE_UPDATE_NOTIFICATION: 'true'
};

const processes = [
  {
    name: 'strapi',
    cwd: path.join(root, 'backend'),
    env: { ...baseEnv, HOST: '127.0.0.1' },
    args: ['node_modules/@strapi/strapi/bin/strapi.js', 'develop']
  },
  {
    name: 'frontend',
    cwd: path.join(root, 'frontend'),
    env: { ...baseEnv, HOST: 'localhost', PORT: '5174' },
    args: ['server.mjs']
  }
];

const children = processes.map((proc) => {
  const child = spawn(node, proc.args, {
    cwd: proc.cwd,
    env: proc.env,
    stdio: ['inherit', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[${proc.name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${proc.name}] ${chunk}`));
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${proc.name}] exited with code ${code}`);
    }
  });

  return child;
});

process.on('SIGINT', () => {
  for (const child of children) child.kill('SIGINT');
  setTimeout(() => process.exit(0), 250);
});
