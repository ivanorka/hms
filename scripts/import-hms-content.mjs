import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const seedPath = path.join(root, 'data', 'hms-seed.json');
const sourceBaseUrl = 'https://hms.hr';

const pageCategory = 'pages';
const postCategory = 'posts';

const technicalKeys = new Set([
  '$id',
  'id',
  'linkId',
  'master_id',
  'media_id',
  'driveId',
  'version',
  'hash',
  'media',
  'access',
  'mime',
  'extension',
  'resourceType',
  'created_at',
  'updated_at',
  'published_at',
  'language_code',
  'hide_translation',
  'manual_edit',
  'seo_priority',
  'seo_changefreq',
  'seo_follow',
  'seo_index',
  'can_comment',
  'site',
  'status',
  'child_order',
  'expiration_date',
  'poll_id',
  'averageRating',
  'schemaMarkup',
  'banners',
  'translation',
  'post_author_user',
  'user',
  'type',
  'terms',
  'products',
  'parent',
  'children',
  'meta',
  'linkMeta',
  'linkOptions'
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sourceUrl(route) {
  if (!route || route === '/') return sourceBaseUrl;
  return `${sourceBaseUrl}/${String(route).replace(/^\/+/, '')}`;
}

function routeForSlug(slug) {
  if (slug === 'naslovna-4' || slug === 'naslovna') return '/';
  return `/${slug}`;
}

function localSlug(slug) {
  return slug === 'naslovna-4' ? 'naslovna' : slug;
}

function replaceBrand(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/Gauss\s*d\.?\s*o\.?\s*o\.?/gi, 'Macevalacki savez');
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeExcerpt(body = '', fallback = '') {
  const text = stripHtml(body || fallback);
  return text.length > 190 ? `${text.slice(0, 187).trim()}...` : text;
}

function isHtml(value = '') {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function isUrl(value = '') {
  return /^https?:\/\//i.test(value) || /^\//.test(value);
}

function mediaUrl(value) {
  if (!value || typeof value !== 'object') return '';
  return value.path || value.newPath || value.url || value.href || '';
}

function sortEntries(entries) {
  const preferred = ['title', 'name', 'subtitle', 'subtitle2', 'description', 'body', 'text', 'content', 'link', 'url', 'href', 'media', 'image'];
  return [...entries].sort(([a], [b]) => {
    const ai = preferred.indexOf(a);
    const bi = preferred.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function valueToHtml(value, key = '') {
  if (value == null || value === false) return '';

  if (typeof value === 'string' || typeof value === 'number') {
    const text = replaceBrand(String(value)).trim();
    if (!text) return '';
    if (isHtml(text)) return text;
    if (isUrl(text)) {
      const label = key && !['href', 'url', 'link', 'path'].includes(key) ? key : text;
      return `<p><a href="${escapeHtml(text)}">${escapeHtml(label)}</a></p>`;
    }
    if (key.toLowerCase().includes('title') || key === 'name') {
      return `<h3>${escapeHtml(text)}</h3>`;
    }
    return `<p>${escapeHtml(text).replace(/\n+/g, '<br>')}</p>`;
  }

  if (Array.isArray(value)) {
    const parts = value.map((item) => valueToHtml(item, key)).filter(Boolean);
    return parts.join('\n');
  }

  if (typeof value === 'object') {
    const directMedia = mediaUrl(value);
    if (directMedia && (value.mime || value.displayName || value.title || value.hash)) {
      const alt = value.title || value.displayName || key || 'media';
      return `<figure><img src="${escapeHtml(directMedia)}" alt="${escapeHtml(alt)}"></figure>`;
    }

    const entries = sortEntries(
      Object.entries(value).filter(([entryKey, entryValue]) => {
        if (technicalKeys.has(entryKey)) return false;
        if (entryValue == null || entryValue === false || entryValue === '') return false;
        return true;
      })
    );

    const parts = entries.map(([entryKey, entryValue]) => valueToHtml(entryValue, entryKey)).filter(Boolean);
    if (!parts.length) return '';
    return `<div class="imported-block">${parts.join('\n')}</div>`;
  }

  return '';
}

function componentToHtml(component) {
  if (!component || typeof component !== 'object') return '';
  const title = component.title || component.name || component.handler;
  const meta = component.linkMeta || component.meta || {};
  const body = valueToHtml(meta);
  if (!body) return '';
  return `<section class="imported-section" data-source-component="${escapeHtml(component.handler || 'component')}">
${title ? `<h2>${escapeHtml(title)}</h2>` : ''}
${body}
</section>`;
}

function pageBodyFromPageData(pageData) {
  const blocks = [];
  if (pageData.body && stripHtml(pageData.body)) blocks.push(replaceBrand(pageData.body));
  if (Array.isArray(pageData.components)) {
    blocks.push(...pageData.components.map(componentToHtml).filter(Boolean));
  }
  return blocks.join('\n') || `<p>${escapeHtml(pageData.title || 'HMS')}</p>`;
}

function extractLinks(html = '') {
  const links = [];
  const seen = new Set();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = replaceBrand(match[1]).trim();
    const title = stripHtml(replaceBrand(match[2])).trim() || href;
    const key = `${title}|${href}`;
    if (!href || seen.has(key)) continue;
    seen.add(key);
    links.push({ title, href });
  }
  return links;
}

async function fetchHtml(route, attempts = 3) {
  const url = route.startsWith('http') ? route : sourceUrl(route);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 HMS local Strapi importer'
      }
    });

    const text = await response.text();
    if (response.ok || text.includes('window.__NUXT__=')) return text;

    if (attempt === attempts) {
      throw new Error(`${response.status} ${response.statusText} for ${url}`);
    }

    await sleep(350 * attempt);
  }

  return '';
}

function parseNuxt(html) {
  const match = html.match(/window\.__NUXT__=(.*?);<\/script>/s);
  if (!match) throw new Error('Nuxt state was not found in HTML');
  return vm.runInNewContext(match[1], Object.create(null));
}

function controllerSearchItems(nuxt) {
  return nuxt.fetch?.['ControllerSearch:0']?.items || [];
}

function controllerSearchPagination(nuxt) {
  return nuxt.fetch?.['ControllerSearch:0']?.paginationData || { totalPages: 1, totalItems: 0 };
}

function editorPosts(nuxt, key) {
  return nuxt.fetch?.[key]?.posts || [];
}

function postToArticle(post, category) {
  const body = replaceBrand(post.body || '');
  return {
    title: replaceBrand(post.title || post.seo_title || post.slug),
    slug: post.slug,
    category,
    excerpt: replaceBrand(post.excerpt || makeExcerpt(body, post.title)),
    body: body || `<p>${escapeHtml(replaceBrand(post.title || post.slug))}</p>`,
    imageUrl: post.media?.path || post.media?.newPath || '',
    sourceUrl: sourceUrl(post.slug),
    publishedAtOriginal: post.published_at || post.created_at || null
  };
}

function sectionForPage(slug, existingPage) {
  if (existingPage?.section) return existingPage.section;

  const groups = {
    HMS: ['o-nama', 'tijela-saveza', 'skupstina', 'odbori', 'komisije', 'ostala-tijela-saveza', 'hms-sredista'],
    Novosti: ['novosti-iz-saveza'],
    Reprezentacija: ['reprezentativci', 'izbornici-i-treneri', 'plan-i-program'],
    Natjecanja: ['kalendar', 'propozicije', 'rezultati', 'rang-liste'],
    Registar: ['sportasi', 'suci', 'treneri', 'delegati', 'povjerenik-za-zastitu-djece'],
    Dokumenti: ['statuti-i-pravilnici', 'antidoping', 'safeguarding', 'kategorizacija-sportasa', 'sportasi-i-obrazovanje', 'pravo-na-pristup-informacijama']
  };

  for (const [section, slugs] of Object.entries(groups)) {
    if (slugs.includes(slug)) return section;
  }

  return 'HMS';
}

async function collectSearch(category) {
  const all = [];
  const firstHtml = await fetchHtml(`/pretrazivanje?category=${category}&page=1`);
  const firstNuxt = parseNuxt(firstHtml);
  const pagination = controllerSearchPagination(firstNuxt);
  all.push(...controllerSearchItems(firstNuxt));

  for (let page = 2; page <= pagination.totalPages; page += 1) {
    const html = await fetchHtml(`/pretrazivanje?category=${category}&page=${page}`);
    const nuxt = parseNuxt(html);
    all.push(...controllerSearchItems(nuxt));
    process.stdout.write('.');
  }

  process.stdout.write('\n');
  return all;
}

async function pageFromSlug(slug, existingPage) {
  const route = routeForSlug(slug);
  const html = await fetchHtml(route);
  const nuxt = parseNuxt(html);
  const pageData = nuxt.data?.[0]?.pageData;
  if (!pageData || pageData.resourceType !== 'post' || pageData.display !== 'components') {
    return null;
  }

  const local = localSlug(pageData.slug || slug);
  const body = pageBodyFromPageData(pageData);
  return {
    title: replaceBrand(pageData.title || existingPage?.title || local),
    slug: local,
    section: sectionForPage(local, existingPage),
    summary: replaceBrand(pageData.seo_description || existingPage?.summary || makeExcerpt(body, pageData.title)),
    body,
    links: extractLinks(body)
  };
}

function mergeBySlug(existingItems, importedItems) {
  const bySlug = new Map();
  for (const item of existingItems) {
    if (item?.slug) bySlug.set(item.slug, { ...item });
  }
  for (const item of importedItems) {
    if (!item?.slug) continue;
    bySlug.set(item.slug, { ...(bySlug.get(item.slug) || {}), ...item });
  }
  return [...bySlug.values()];
}

function dedupeArticles(items) {
  const bySlug = new Map();
  for (const item of items) {
    if (!item?.slug) continue;
    const existing = bySlug.get(item.slug);
    if (!existing) {
      bySlug.set(item.slug, item);
      continue;
    }

    const currentBodyLength = (item.body || '').length;
    const existingBodyLength = (existing.body || '').length;
    const category = existing.category === 'Novosti' || item.category === 'Novosti' ? 'Novosti' : item.category || existing.category;
    bySlug.set(item.slug, {
      ...existing,
      ...item,
      category,
      body: currentBodyLength >= existingBodyLength ? item.body : existing.body
    });
  }

  return [...bySlug.values()].sort((a, b) => {
    const ad = a.publishedAtOriginal ? Date.parse(a.publishedAtOriginal) : 0;
    const bd = b.publishedAtOriginal ? Date.parse(b.publishedAtOriginal) : 0;
    return bd - ad;
  });
}

async function main() {
  const seed = JSON.parse(await fs.readFile(seedPath, 'utf8'));

  console.log('Collecting posts from HMS search...');
  const searchPosts = await collectSearch(postCategory);

  console.log('Collecting visible news lists...');
  const newsNuxt = parseNuxt(await fetchHtml('/novosti-iz-saveza'));
  const featuredPosts = editorPosts(newsNuxt, 'EditorPostList:0');
  const noticePosts = editorPosts(newsNuxt, 'EditorPostList:1');

  const articles = dedupeArticles([
    ...searchPosts.map((post) => postToArticle(post, 'Obavijesti')),
    ...noticePosts.map((post) => postToArticle(post, 'Obavijesti')),
    ...featuredPosts.map((post) => postToArticle(post, 'Novosti'))
  ]).map((article, index) => ({ ...article, order: index + 1 }));

  console.log('Collecting pages from HMS search...');
  const searchPages = await collectSearch(pageCategory);
  const existingPages = new Map((seed.pages || []).map((page) => [page.slug, page]));
  const importedPages = [];
  const seenPageSlugs = new Set();

  for (const item of searchPages) {
    const slug = localSlug(item.slug);
    if (!slug || seenPageSlugs.has(slug)) continue;
    seenPageSlugs.add(slug);

    try {
      const page = await pageFromSlug(item.slug, existingPages.get(slug));
      if (page) importedPages.push(page);
      process.stdout.write('+');
    } catch (error) {
      process.stdout.write('-');
    }
  }
  process.stdout.write('\n');

  const pages = mergeBySlug(seed.pages || [], importedPages).map((page, index) => ({ ...page, order: index + 1 }));

  const nextSeed = {
    ...seed,
    site: {
      ...seed.site,
      logoImageUrl: seed.site.logoImageUrl || '',
      heroImageUrl: seed.site.heroImageUrl || '',
      homePage: {
        heroEyebrow: 'Hrvatski mačevalački savez',
        heroTitle: 'Mačevanje u Hrvatskoj, jasno i na jednom mjestu',
        heroIntro: 'Službene informacije Saveza, novosti, dokumenti, natjecanja i registri za sportaše, klubove, trenere i roditelje.',
        primaryCtaLabel: 'Pogledaj novosti',
        primaryCtaHref: '/novosti-iz-saveza',
        secondaryCtaLabel: 'Pronađi klub',
        secondaryCtaHref: '/pronadem-klub-za-sebe-1',
        quickTitle: 'Kako možemo pomoći?',
        quickIntro: 'Najčešći koraci za članove, klubove i nove natjecatelje.',
        newsEyebrow: 'Aktualno',
        newsTitle: 'Najnovije iz Saveza',
        newsLinkLabel: 'Sve novosti',
        newsLinkHref: '/novosti-iz-saveza',
        featuredArticleCount: 6,
        ...(seed.site.homePage || {})
      },
      footerLinks: [
        { title: 'Pravila privatnosti', href: '/pravila-privatnosti' }
      ],
      copyright: '© 2024. Sva prava pridržana - Macevalacki savez',
      sourceBaseUrl
    },
    pages,
    articles
  };

  await fs.writeFile(seedPath, `${JSON.stringify(nextSeed, null, 2)}\n`);

  const articleBodyCount = articles.filter((article) => stripHtml(article.body).length > 30).length;
  console.log(`Imported ${pages.length} pages and ${articles.length} articles (${articleBodyCount} with body text).`);
  console.log(`Featured list total reported by HMS: ${newsNuxt.fetch?.['EditorPostList:0']?.paginationData?.totalItems ?? 'unknown'}.`);
  console.log(`Notice list total reported by HMS: ${newsNuxt.fetch?.['EditorPostList:1']?.paginationData?.totalItems ?? 'unknown'}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
