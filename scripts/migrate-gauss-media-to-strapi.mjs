import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const backendDir = path.join(root, 'backend');
const seedPath = path.join(root, 'data', 'hms-seed.json');
const manifestPath = path.join(root, 'data', 'hms-media-map.json');
const sourceBaseUrl = 'https://hms.hr';
const userAgent = 'Mozilla/5.0 HMS local Strapi media migration';

const mimeExtensions = new Map([
  ['application/pdf', '.pdf'],
  ['application/msword', '.doc'],
  ['application/x-cfb', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['image/avif', '.avif'],
  ['image/gif', '.gif'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/svg+xml', '.svg'],
  ['image/webp', '.webp']
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtmlEntities(value = '') {
  return String(value).replace(/&amp;/g, '&');
}

function encodeHtmlEntities(value = '') {
  return String(value).replace(/&/g, '&amp;');
}

function canonicalizeAbsoluteUrl(value) {
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

function mediaReference(rawValue) {
  const raw = decodeHtmlEntities(rawValue).trim();
  if (!raw) return null;

  const absolute = raw.startsWith('/media/') ? `${sourceBaseUrl}${raw}` : raw;
  if (!/^https?:\/\//i.test(absolute)) return null;

  const canonical = canonicalizeAbsoluteUrl(absolute);
  if (!canonical) return null;

  const url = new URL(canonical);
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname;
  const isGaussApi = host === 'api.gaussbox.com' || host.endsWith('.gaussbox.com');
  const isGaussStorage = host === 'storage.googleapis.com' && pathname.startsWith('/main-gaussbox-gcr/');
  const isLegacyHmsMedia = host.startsWith('v3-hms-master-') && host.endsWith('.a.run.app') && pathname.startsWith('/media/');
  const isHmsMedia = host === 'hms.hr' && pathname.startsWith('/media/');

  if (!isGaussApi && !isGaussStorage && !isLegacyHmsMedia && !isHmsMedia) return null;

  return {
    canonical,
    fetchUrl: canonical,
    rawValues: new Set([rawValue, raw, canonical, encodeHtmlEntities(raw)])
  };
}

function collectMediaReferences(value, references = new Map()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectMediaReferences(item, references));
    return references;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectMediaReferences(item, references));
    return references;
  }

  if (typeof value !== 'string') return references;

  const exact = mediaReference(value);
  if (exact) addReference(references, exact);

  for (const match of value.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    const reference = mediaReference(match[1]);
    if (reference) addReference(references, reference);
  }

  return references;
}

function addReference(references, reference) {
  const current = references.get(reference.canonical) || {
    canonical: reference.canonical,
    fetchUrl: reference.fetchUrl,
    rawValues: new Set()
  };

  reference.rawValues.forEach((raw) => current.rawValues.add(raw));
  references.set(reference.canonical, current);
}

function extensionFromMime(mime = '') {
  return mimeExtensions.get(String(mime).toLowerCase()) || '';
}

function contentTypeFromHeaders(headers) {
  return (headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
}

function filenameFromDisposition(disposition = '') {
  const utf = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf) return decodeURIComponent(utf[1].trim().replace(/^["']|["']$/g, ''));
  const plain = disposition.match(/filename=["']?([^"';]+)["']?/i);
  return plain ? plain[1].trim() : '';
}

function filenameFromUrl(value = '') {
  try {
    const url = new URL(value);
    const segments = decodeURIComponent(url.pathname)
      .split('/')
      .filter(Boolean)
      .reverse();

    return segments.find((segment) => /\.[a-z0-9]{2,8}$/i.test(segment)) || '';
  } catch {
    return '';
  }
}

function hashFromUrl(value = '') {
  try {
    const url = new URL(value);
    const hash = url.searchParams.get('hash');
    if (hash) return hash.replace(/[^a-z0-9]+/gi, '').slice(0, 18);
  } catch {
    // Ignore and use fallback below.
  }

  return '';
}

function normalizeExtension(filename, mime, fallbackBase) {
  const desiredExt = extensionFromMime(mime);
  let next = filename || fallbackBase || 'hms-media';

  if (mime === 'application/pdf') {
    next = next.replace(/-?pdf\.png$/i, '.pdf');
  }

  const currentExt = path.extname(next);
  if (desiredExt && currentExt.toLowerCase() !== desiredExt) {
    next = currentExt ? `${next.slice(0, -currentExt.length)}${desiredExt}` : `${next}${desiredExt}`;
  }

  if (!path.extname(next) && desiredExt) next = `${next}${desiredExt}`;
  return next;
}

function sanitizeFilename(filename, mime, fallbackBase) {
  const withExtension = normalizeExtension(filename, mime, fallbackBase);
  const ext = path.extname(withExtension).toLowerCase();
  const base = path
    .basename(withExtension, ext)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 120);

  return `${base || fallbackBase || 'hms-media'}${ext || extensionFromMime(mime) || '.bin'}`.toLowerCase();
}

function uploadFilename(reference, responseUrl, headers, mime) {
  const fromDisposition = filenameFromDisposition(headers.get('content-disposition') || '');
  const fromOriginal = filenameFromUrl(reference.canonical);
  const fromResponse = filenameFromUrl(responseUrl);
  const fallbackBase = hashFromUrl(reference.canonical) || `hms-media-${Math.abs(hashCode(reference.canonical))}`;
  return sanitizeFilename(fromDisposition || fromOriginal || fromResponse, mime, fallbackBase);
}

function hashCode(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return hash;
}

async function fetchMedia(reference, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(reference.fetchUrl, {
        redirect: 'follow',
        headers: {
          accept: '*/*',
          referer: sourceBaseUrl,
          'user-agent': userAgent
        }
      });

      const buffer = Buffer.from(await response.arrayBuffer());
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${buffer.slice(0, 160).toString('utf8')}`);
      }

      if (!buffer.length) throw new Error('Empty response body');

      return {
        buffer,
        filename: uploadFilename(reference, response.url, response.headers, contentTypeFromHeaders(response.headers)),
        mime: contentTypeFromHeaders(response.headers),
        finalUrl: response.url
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }

  throw lastError;
}

async function uploadToStrapi(strapi, reference) {
  const media = await fetchMedia(reference);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hms-media-'));
  const filepath = path.join(tmpDir, media.filename);

  try {
    await fs.writeFile(filepath, media.buffer);
    const uploaded = await strapi.plugin('upload').service('upload').upload({
      data: {
        fileInfo: {
          name: media.filename,
          alternativeText: media.filename
        }
      },
      files: {
        filepath,
        originalFilename: media.filename,
        mimetype: media.mime,
        size: media.buffer.length
      }
    });

    const file = uploaded?.[0];
    if (!file?.url) throw new Error(`Strapi upload did not return a URL for ${reference.canonical}`);

    return {
      name: file.name || media.filename,
      url: file.url,
      mime: file.mime || media.mime,
      size: file.size,
      source: reference.canonical,
      finalSource: media.finalUrl
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function replacementEntries(references, manifest) {
  const entries = [];

  for (const reference of references.values()) {
    const migrated = manifest[reference.canonical];
    if (!migrated?.url) continue;

    const values = new Set(reference.rawValues);
    values.add(reference.canonical);
    values.add(encodeHtmlEntities(reference.canonical));

    for (const value of values) {
      entries.push([value, migrated.url]);
    }
  }

  return entries
    .filter(([from, to]) => from && to && from !== to)
    .sort((a, b) => b[0].length - a[0].length);
}

function replaceLegacyAppUrl(match) {
  if (/\/media\//i.test(match)) return match;

  try {
    const url = new URL(decodeHtmlEntities(match));
    return `${url.pathname || '/'}${url.search}${url.hash}`;
  } catch {
    return match;
  }
}

function replaceInString(value, replacements) {
  let next = value;

  for (const [from, to] of replacements) {
    next = next.split(from).join(to);
  }

  return next.replace(/https?:\/\/v3-hms-master-[^/"'<\s]+\.a\.run\.app\/?[^"'<\s]*/gi, replaceLegacyAppUrl);
}

function deepReplace(value, replacements) {
  if (Array.isArray(value)) return value.map((item) => deepReplace(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepReplace(item, replacements)]));
  }
  if (typeof value === 'string') return replaceInString(value, replacements);
  return value;
}

async function readManifest() {
  try {
    return JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    return {};
  }
}

async function writeManifest(manifest) {
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function loadBackendEnv() {
  const envPath = path.join(backendDir, '.env');
  let content = '';

  try {
    content = await fs.readFile(envPath, 'utf8');
  } catch {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');

    if (key && process.env[key] == null) process.env[key] = value;
  }
}

async function upsertSingle(strapi, uid, data) {
  const documents = strapi.documents(uid);
  const current =
    (await documents.findFirst({ status: 'draft' })) ||
    (await documents.findFirst({ status: 'published' }));

  if (current?.documentId) {
    await documents.update({ documentId: current.documentId, data, status: 'published' });
    return;
  }

  await documents.create({ data, status: 'published' });
}

async function upsertBySlug(strapi, uid, data, order) {
  const documents = strapi.documents(uid);
  const filters = { slug: { $eq: data.slug } };
  const current =
    (await documents.findFirst({ filters, status: 'draft' })) ||
    (await documents.findFirst({ filters, status: 'published' }));
  const payload = { ...data, order };

  if (current?.documentId) {
    await documents.update({ documentId: current.documentId, data: payload, status: 'published' });
    return;
  }

  await documents.create({ data: payload, status: 'published' });
}

async function syncSeedToStrapi(strapi, seed) {
  await upsertSingle(strapi, 'api::site-setting.site-setting', seed.site);

  for (const [index, page] of (seed.pages || []).entries()) {
    await upsertBySlug(strapi, 'api::page.page', page, index + 1);
  }

  for (const [index, article] of (seed.articles || []).entries()) {
    await upsertBySlug(strapi, 'api::article.article', article, index + 1);
  }
}

function hasGaussReference(value) {
  return /gaussbox|main-gaussbox-gcr|v3-hms-master/i.test(JSON.stringify(value));
}

async function loadStrapi() {
  await loadBackendEnv();

  process.env.DATABASE_FILENAME ||= '.tmp/data.db';
  process.env.XDG_CONFIG_HOME ||= path.join(backendDir, '.strapi-config');
  process.env.STRAPI_TELEMETRY_DISABLED = 'true';
  process.env.STRAPI_DISABLE_UPDATE_NOTIFICATION = 'true';

  const strapiModule = await import(pathToFileURL(path.join(backendDir, 'node_modules/@strapi/strapi/dist/index.js')).href);
  const previousCwd = process.cwd();
  process.chdir(backendDir);

  const strapi = await strapiModule.createStrapi({
    appDir: backendDir,
    distDir: path.join(backendDir, 'dist'),
    autoReload: false
  }).load();

  return { strapi, previousCwd };
}

async function main() {
  const seed = JSON.parse(await fs.readFile(seedPath, 'utf8'));
  const references = collectMediaReferences(seed);
  const manifest = await readManifest();
  const pending = [...references.values()].filter((reference) => !manifest[reference.canonical]?.url);

  console.log(`Found ${references.size} media URLs (${pending.length} pending upload).`);

  const { strapi, previousCwd } = await loadStrapi();

  try {
    let uploadedCount = 0;
    const failures = [];

    for (const [index, reference] of pending.entries()) {
      try {
        const migrated = await uploadToStrapi(strapi, reference);
        manifest[reference.canonical] = migrated;
        uploadedCount += 1;
        console.log(`[${index + 1}/${pending.length}] ${migrated.url}`);
        await writeManifest(manifest);
      } catch (error) {
        failures.push({ url: reference.canonical, error: error.message });
        console.warn(`[failed] ${reference.canonical}`);
        console.warn(`         ${error.message}`);
      }
    }

    const replacements = replacementEntries(references, manifest);
    const nextSeed = deepReplace(seed, replacements);
    await fs.writeFile(seedPath, `${JSON.stringify(nextSeed, null, 2)}\n`);
    await syncSeedToStrapi(strapi, nextSeed);

    const fileCount = await strapi.db.query('plugin::upload.file').count();
    const remainingGauss = hasGaussReference(nextSeed);

    console.log(`Uploaded ${uploadedCount} new files. Media library now has ${fileCount} files.`);
    console.log(`Seed still references Gauss: ${remainingGauss ? 'yes' : 'no'}.`);

    if (failures.length) {
      await fs.writeFile(
        path.join(root, 'data', 'hms-media-failures.json'),
        `${JSON.stringify(failures, null, 2)}\n`
      );
      console.log(`Failures: ${failures.length}. See data/hms-media-failures.json.`);
      process.exitCode = 1;
    }
  } finally {
    await strapi.destroy();
    process.chdir(previousCwd);
  }

  if (!fssync.existsSync(path.join(backendDir, 'public/uploads'))) {
    throw new Error('Expected backend/public/uploads to exist after migration.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
