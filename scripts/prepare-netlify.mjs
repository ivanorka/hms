import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'frontend', 'public');
const publicDataDir = path.join(publicDir, 'data');
const publicUploadsDir = path.join(publicDir, 'uploads');
const sourceUploadsDir = path.join(root, 'backend', 'public', 'uploads');

async function main() {
  await fs.mkdir(publicDataDir, { recursive: true });
  await fs.copyFile(
    path.join(root, 'data', 'hms-seed.json'),
    path.join(publicDataDir, 'hms-seed.json')
  );

  await fs.rm(publicUploadsDir, { recursive: true, force: true });
  await fs.cp(sourceUploadsDir, publicUploadsDir, { recursive: true });

  console.log('Prepared Netlify static seed and uploads.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
