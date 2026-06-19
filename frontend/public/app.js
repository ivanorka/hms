const STRAPI_URL = window.STRAPI_URL || 'http://localhost:1337';
const app = document.querySelector('#app');

let state = {
  site: null,
  pages: [],
  articles: [],
  searchOpen: false,
  searchTerm: ''
};

const stripSlash = (value = '') => value.replace(/^\/+|\/+$/g, '');
const routeSlug = () => stripSlash(window.location.pathname) || 'naslovna';
const samePath = (href) => stripSlash(href || '/') === routeSlug();
const html = (value = '') => value;
const stripHtml = (value = '') => String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const assetUrl = (value = '') => String(value || '').startsWith('/uploads/')
  ? (document.documentElement.dataset.cms === 'strapi' ? `${STRAPI_URL}${value}` : value)
  : value;

function imageAlt(attributes = '') {
  const match = String(attributes).match(/\balt=(["'])(.*?)\1/i);
  return match?.[2] || 'Dokument';
}

function mediaHtml(value = '') {
  const body = String(value).replace(
    /<figure>\s*<img\b([^>]*?)\bsrc=(["'])(\/uploads\/[^"']+\.(?:pdf|docx?|xlsx?|pptx?)[^"']*)\2([^>]*)>\s*<\/figure>/gi,
    (_match, before, _quote, src, after) =>
      `<p><a href="${assetUrl(src)}" target="_blank" rel="noopener noreferrer">${imageAlt(`${before} ${after}`)}</a></p>`
  );

  return html(body.replace(/\b(src|href)=(["'])\/uploads\//gi, `$1=$2${STRAPI_URL}/uploads/`));
}

function homeSettings() {
  return {
    heroEyebrow: 'Hrvatski mačevalački savez',
    heroTitle: state.site.heroTitle || state.site.siteName,
    heroIntro: 'Službene informacije Saveza, novosti, dokumenti, natjecanja i registri.',
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
    ...(state.site.homePage || {})
  };
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('hr-HR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function excerpt(value, limit = 140) {
  const text = stripHtml(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
}

function seasonLabelFromHref(href = '') {
  const match = String(href).match(/(20\d{2})[-_](20\d{2})/);
  return match ? `${match[1]}./${match[2]}.` : '';
}

function isNoisyLinkTitle(title = '') {
  const value = String(title).trim();
  return !value || value === 'formattedPath' || value === 'name' || value === '_blank' || isUrl(value);
}

function titleFromHref(href = '') {
  const decoded = decodeURIComponent(String(href));
  const parts = decoded.split('/').filter(Boolean);
  const filePart = [...parts].reverse().find((part) => /\.(pdf|png|jpe?g|webp)$/i.test(part)) || parts.at(-1) || 'Dokument';
  return filePart
    .replace(/\.(pdf|png|jpe?g|webp)$/ig, '')
    .replace(/-?pdf$/i, '')
    .replace(/\b(zavrsno|objava|dodavanje|bez|tc|v)\b/gi, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toLocaleUpperCase('hr-HR')) || 'Dokument';
}

function linkTitle(item, page) {
  const href = item.href || '';
  const season = seasonLabelFromHref(href);

  if (page.slug === 'reprezentativci') {
    return season ? `Reprezentativci HMS-a u sezoni ${season}` : 'Popis reprezentativaca HMS-a';
  }

  if (page.slug === 'plan-i-program') {
    if (/kriteriji/i.test(href)) {
      return season ? `Kriteriji nacionalne reprezentacije ${season}` : 'Kriteriji nacionalne reprezentacije';
    }
    return season ? `Godišnji plan i program reprezentacije ${season}` : 'Godišnji plan i program reprezentacije';
  }

  return isNoisyLinkTitle(item.title) ? titleFromHref(href) : item.title;
}

function isDocumentHref(href = '') {
  return /\/(media|uploads)\//i.test(href) || /\.(pdf|png|jpe?g|webp|svg|avif)(?:[/?#]|$)/i.test(href);
}

function hrefForRender(href = '') {
  if (href.startsWith('/uploads/')) return assetUrl(href);
  if (href.startsWith('/media/')) return `${state.site.sourceBaseUrl || 'https://hms.hr'}${href}`;
  return href;
}

function normalizePageLinks(page) {
  const byHref = new Map();
  for (const item of page.links || []) {
    if (!item?.href) continue;
    const href = hrefForRender(item.href);
    if (byHref.has(href)) continue;
    byHref.set(href, {
      ...item,
      href,
      title: linkTitle(item, page),
      season: seasonLabelFromHref(item.href)
    });
  }
  return [...byHref.values()];
}

function cleanImportedBody(body = '') {
  return String(body)
    .replace(/<h2>[a-z0-9-]+<\/h2>\s*/gi, '')
    .replace(/<p>\s*(formattedPath|_blank|name)\s*<\/p>\s*/gi, '');
}

function shouldUseDocumentLayout(page) {
  return ['reprezentativci', 'plan-i-program'].includes(page.slug);
}

function normalizeEntry(entry) {
  if (!entry) return entry;
  const attributes = entry.attributes || entry;
  return { id: entry.id, documentId: entry.documentId, ...attributes };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchCollection(collection, sort = 'order:asc') {
  const pageSize = 100;
  let page = 1;
  const entries = [];

  while (true) {
    const params = new URLSearchParams();
    params.set('pagination[pageSize]', String(pageSize));
    params.set('pagination[page]', String(page));
    params.set('sort', sort);

    const response = await fetchJson(`${STRAPI_URL}/api/${collection}?${params}`);
    entries.push(...(response.data || []).map(normalizeEntry));

    const pagination = response.meta?.pagination;
    if (!pagination || page >= pagination.pageCount) break;
    page += 1;
  }

  return entries;
}

async function loadFromStrapi() {
  const [settingResponse, pages, articles] = await Promise.all([
    fetchJson(`${STRAPI_URL}/api/site-setting`),
    fetchCollection('pages'),
    fetchCollection('articles')
  ]);

  const setting = normalizeEntry(settingResponse.data);
  return {
    site: setting,
    pages,
    articles
  };
}

async function loadSeed() {
  const seed = await fetchJson('/data/hms-seed.json');
  return {
    site: seed.site,
    pages: seed.pages.map((page, index) => ({ ...page, order: index + 1 })),
    articles: seed.articles.map((article, index) => ({ ...article, order: index + 1 }))
  };
}

function navigate(href) {
  if (!href) return;
  if (/^https?:\/\//.test(href)) {
    window.open(href, '_blank', 'noopener,noreferrer');
    return;
  }
  history.pushState({}, '', href);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function link(href, label, className = '') {
  return `<a href="${href}" class="${className}" data-link>${label}</a>`;
}

function buttonLink(href, label, className = '') {
  return `<button class="${className}" data-href="${href}">${label}</button>`;
}

function renderHeader() {
  const nav = state.site.navigation || [];
  const logo = state.site.logoImageUrl
    ? `<img class="brand-logo" src="${assetUrl(state.site.logoImageUrl)}" alt="${state.site.siteName}">`
    : `<span class="brand-mark">${state.site.logoText || 'HMS'}</span>`;
  const menu = nav
    .map((group) => {
      const groupChildren = group.children || [];
      const active = groupChildren.some((item) => samePath(item.href)) ? 'active' : '';

      if (groupChildren.length === 1) {
        const item = groupChildren[0];
        return `
        <li class="nav-item nav-link-item ${active}">
          ${link(item.href, group.title, 'nav-label')}
        </li>`;
      }

      const children = groupChildren
        .map((item) => `<li>${link(item.href, item.title, samePath(item.href) ? 'active' : '')}</li>`)
        .join('');
      return `
        <li class="nav-item ${active}">
          <span class="nav-label">${group.title}</span>
          <ul class="submenu">${children}</ul>
        </li>`;
    })
    .join('');

  return `
    <header class="site-header">
      <div class="header-inner">
        <a href="/" class="brand" data-link aria-label="${state.site.siteName}">
          ${logo}
        </a>
        <nav class="desktop-nav"><ul>${menu}</ul></nav>
        <div class="header-actions">
          <button class="icon-button mobile-menu-button" aria-label="Menu" data-menu-toggle>
            <span></span><span></span><span></span>
          </button>
          <button class="icon-button search-button" aria-label="Search" data-search-toggle>
            <span class="search-circle"></span><span class="search-stem"></span>
          </button>
        </div>
      </div>
      <nav class="mobile-nav" hidden><ul>${menu}</ul></nav>
      ${state.searchOpen ? renderSearch() : ''}
    </header>`;
}

function renderSearch() {
  const term = state.searchTerm.trim().toLowerCase();
  const results = term
    ? [
        ...state.pages
          .filter((page) => `${page.title} ${page.summary}`.toLowerCase().includes(term))
          .map((page) => ({ title: page.title, href: `/${page.slug}`, type: page.section || 'Stranica' })),
        ...state.articles
          .filter((article) => `${article.title} ${article.category}`.toLowerCase().includes(term))
          .map((article) => ({ title: article.title, href: `/${article.slug}`, type: article.category || 'Novost' }))
      ].slice(0, 8)
    : [];

  return `
    <div class="search-overlay">
      <form class="search-form">
        <input id="searchInput" name="search" type="search" value="${state.searchTerm}" autocomplete="off" autofocus>
        <button type="button" class="close-search" data-search-close aria-label="Close"></button>
      </form>
      <div class="search-results">
        ${results.map((result) => `<a href="${result.href}" data-link><span>${result.type}</span>${result.title}</a>`).join('')}
      </div>
    </div>`;
}

function renderHome() {
  const home = homeSettings();
  const featuredArticleCount = Math.max(1, Number(home.featuredArticleCount || 6));
  const articles = state.articles.slice(0, featuredArticleCount);
  const latest = articles[0];
  const quickItems = home.quickLinks || state.site.quickLinks || [];
  const quickLinks = quickItems
    .map((item) => `<a href="${item.href}" data-link><span>${item.title}</span></a>`)
    .join('');

  return `
    <main>
      <section class="hero">
        <img src="${assetUrl(state.site.heroImageUrl)}" alt="" loading="eager" class="hero-image">
        <div class="hero-shade"></div>
        <div class="hero-inner">
          <div class="hero-copy">
            <p class="hero-eyebrow">${home.heroEyebrow}</p>
            <h1>${home.heroTitle}</h1>
            <p>${home.heroIntro}</p>
            <div class="hero-actions">
              ${link(home.primaryCtaHref, home.primaryCtaLabel, 'button-primary')}
              ${link(home.secondaryCtaHref, home.secondaryCtaLabel, 'button-secondary')}
            </div>
          </div>
          ${latest ? `
            <a href="/${latest.slug}" class="hero-latest" data-link>
              <span>${latest.category || 'Novost'}</span>
              <strong>${latest.title}</strong>
              <em>${formatDate(latest.publishedAtOriginal || latest.publishedAt)}</em>
            </a>` : ''}
        </div>
      </section>
      <section class="quick-section section">
        <div class="quick-panel">
          <div>
            <p class="section-kicker">Brze akcije</p>
            <h2>${home.quickTitle}</h2>
            <p>${home.quickIntro}</p>
          </div>
          <div class="quick-grid">${quickLinks}</div>
        </div>
      </section>
      <section class="news-home section">
        <div class="section-head">
          <div>
            <p class="section-kicker">${home.newsEyebrow}</p>
            <h2>${home.newsTitle}</h2>
          </div>
          ${link(home.newsLinkHref, home.newsLinkLabel, 'outline-link')}
        </div>
        <div class="article-grid">
          ${articles.map((article, index) => renderArticleCard(article, index)).join('')}
        </div>
      </section>
    </main>`;
}

function renderArticleCard(article, index = 0) {
  const date = formatDate(article.publishedAtOriginal || article.publishedAt);
  const summary = excerpt(article.body, index === 0 ? 190 : 120);

  return `
    <article class="article-card ${index === 0 ? 'featured-card' : ''}">
      <a href="/${article.slug}" class="article-image" data-link>
        <img src="${assetUrl(article.imageUrl)}" alt="" loading="lazy">
      </a>
      <div class="article-content">
        <div class="article-meta">
          <span>${article.category || 'Novost'}</span>
          ${date ? `<time>${date}</time>` : ''}
        </div>
        <h3>${article.title}</h3>
        ${summary ? `<p>${summary}</p>` : ''}
        ${link(`/${article.slug}`, 'Pročitaj sve', 'read-more')}
      </div>
    </article>`;
}

function renderNewsPage() {
  const tabs = ['Novosti', 'Obavijesti'];
  const active = new URLSearchParams(window.location.search).get('tab') || 'Novosti';
  const articles = state.articles.filter((article) => (article.category || 'Novosti') === active);

  return `
    <main class="section page-section">
      <div class="tabs">
        ${tabs.map((tab) => `<button class="${tab === active ? 'active' : ''}" data-tab="${tab}">${tab.toUpperCase()}</button>`).join('')}
      </div>
      <div class="article-grid news-grid">
        ${articles.map(renderArticleCard).join('')}
      </div>
    </main>`;
}

function renderArticlePage(article) {
  return `
    <main class="section page-section article-detail">
      <div class="eyebrow">${article.category || 'Novost'}</div>
      <h1>${article.title}</h1>
      <img src="${assetUrl(article.imageUrl)}" alt="" class="detail-image">
      <div class="body">${mediaHtml(article.body)}</div>
      ${article.sourceUrl ? `<a href="${article.sourceUrl}" target="_blank" rel="noopener noreferrer" class="source-link">Izvorni link</a>` : ''}
    </main>`;
}

function renderPage(page) {
  const pageLinks = normalizePageLinks(page);
  const documentLayout = shouldUseDocumentLayout(page);
  const links = pageLinks
    .map((item) => {
      const external = /^https?:\/\//.test(item.href) || isDocumentHref(item.href);
      return `
        <a href="${item.href}" ${external ? 'target="_blank" rel="noopener noreferrer"' : 'data-link'}>
          <span class="link-title">${item.title}</span>
          <span class="link-meta">${item.season || (isDocumentHref(item.href) ? 'Dokument' : 'Stranica')}</span>
        </a>`;
    })
    .join('');
  const body = documentLayout ? '' : cleanImportedBody(page.body);

  return `
    <main class="section page-section ${documentLayout ? 'document-page' : ''}">
      <div class="eyebrow">${page.section || 'HMS'}</div>
      <h1>${page.title}</h1>
      <p class="summary">${page.summary || ''}</p>
      ${body ? `<div class="body">${mediaHtml(body)}</div>` : ''}
      ${links ? `
        <div class="document-block">
          <div class="document-head">
            <p class="section-kicker">Dokumenti</p>
            <h2>${documentLayout ? 'Dokumenti za preuzimanje' : 'Povezani linkovi'}</h2>
          </div>
          <div class="link-list">${links}</div>
        </div>` : ''}
    </main>`;
}

function renderFooter() {
  const home = homeSettings();
  const contact = state.site.contact || {};
  const footerLinks = (state.site.footerLinks || [])
    .filter((item) => !['Poveznice', 'Grafički standardi'].includes((item.title || '').trim()))
    .map((item) => `<a href="${item.href}" data-link>${item.title}</a>`)
    .join('');
  const sponsors = (state.site.sponsors || [])
    .map((item) => `<img src="${assetUrl(item.imageUrl)}" alt="${item.title}" loading="lazy">`)
    .join('');
  const social = (state.site.socialLinks || [])
    .map((item) => `<a href="${item.href || '#'}"><img src="${assetUrl(item.imageUrl)}" alt="${item.title}" loading="lazy"></a>`)
    .join('');

  return `
    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-top">
          <div>
            <h2>${home.heroTitle}</h2>
            <div class="footer-buttons">
              ${buttonLink('/kontakti', 'Kontaktirajte nas', 'footer-primary')}
              ${buttonLink('/o-nama', 'Više o nama', 'footer-secondary')}
            </div>
          </div>
          <div class="sponsors"><span>SPONZORI</span>${sponsors}</div>
        </div>
        <div class="footer-info">
          <div class="social">${social}</div>
          <div>${(contact.address || []).map((item) => `<p>${item}</p>`).join('')}</div>
          <div>${[...(contact.phones || []), contact.email].filter(Boolean).map((item) => `<p>${item}</p>`).join('')}</div>
          <div>${[contact.oib, contact.iban, contact.bank, contact.swift].filter(Boolean).map((item) => `<p>${item}</p>`).join('')}</div>
        </div>
        <div class="copyright">
          <span>${state.site.copyright}</span>
          <button class="back-top" data-top>NA POČETAK</button>
        </div>
        ${footerLinks ? `<div class="footer-links">${footerLinks}</div>` : ''}
      </div>
    </footer>`;
}

function renderMain() {
  const slug = routeSlug();
  if (slug === 'naslovna') return renderHome();
  if (slug === 'novosti-iz-saveza') return renderNewsPage();

  const article = state.articles.find((item) => item.slug === slug);
  if (article) return renderArticlePage(article);

  const page = state.pages.find((item) => item.slug === slug);
  if (page) return renderPage(page);

  return renderPage({
    title: 'Stranica',
    section: 'HMS',
    summary: 'Tražena ruta postoji u navigaciji ili se može dodati kroz Strapi.',
    body: `<p>${slug}</p>`,
    links: [{ title: 'Naslovna', href: '/' }]
  });
}

function bindEvents() {
  document.querySelectorAll('[data-link]').forEach((node) => {
    node.addEventListener('click', (event) => {
      const href = node.getAttribute('href');
      if (!href || /^https?:\/\//.test(href)) return;
      event.preventDefault();
      navigate(href);
    });
  });

  document.querySelectorAll('[data-href]').forEach((node) => {
    node.addEventListener('click', () => navigate(node.dataset.href));
  });

  document.querySelector('[data-search-toggle]')?.addEventListener('click', () => {
    state.searchOpen = true;
    render();
    document.querySelector('#searchInput')?.focus();
  });

  document.querySelector('[data-search-close]')?.addEventListener('click', () => {
    state.searchOpen = false;
    state.searchTerm = '';
    render();
  });

  document.querySelector('.search-form')?.addEventListener('submit', (event) => event.preventDefault());
  document.querySelector('#searchInput')?.addEventListener('input', (event) => {
    state.searchTerm = event.target.value;
    render();
  });

  document.querySelector('[data-menu-toggle]')?.addEventListener('click', () => {
    const mobile = document.querySelector('.mobile-nav');
    mobile.hidden = !mobile.hidden;
  });

  document.querySelectorAll('[data-tab]').forEach((node) => {
    node.addEventListener('click', () => {
      history.pushState({}, '', `/novosti-iz-saveza?tab=${encodeURIComponent(node.dataset.tab)}`);
      render();
    });
  });

  document.querySelector('[data-top]')?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function render() {
  document.title = `${state.site.siteName}`;
  app.innerHTML = `${renderHeader()}${renderMain()}${renderFooter()}`;
  bindEvents();

  if (state.searchOpen) {
    const input = document.querySelector('#searchInput');
    input?.focus();
    input?.setSelectionRange(state.searchTerm.length, state.searchTerm.length);
  }
}

async function init() {
  try {
    state = { ...state, ...(await loadFromStrapi()) };
    document.documentElement.dataset.cms = 'strapi';
  } catch (error) {
    state = { ...state, ...(await loadSeed()) };
    document.documentElement.dataset.cms = 'seed';
  }

  window.addEventListener('popstate', render);
  render();
}

init();
