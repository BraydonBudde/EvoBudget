// ══════════════════════════════════════════════════════════════════════
// Blog renderer. One page serves two views:
//   /blog          index
//   /blog?p=slug   article
//
// Posts come from two places and are merged: BLOG_POSTS (shipped in
// blog-posts.js, so the page renders instantly and works with no network)
// and the Blogs sheet behind the Apps Script (so the admin can publish
// without a deploy). A sheet post with the same slug replaces the shipped
// one, which is what makes the seeded posts editable from the admin.
// ══════════════════════════════════════════════════════════════════════

const BLOG_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzill8JQ1BwGzjBMmVm8ucbco-lF1ouvZr6KmDe_CyfloJCzy69Xi-ZSheARQtR0InO/exec';
const BLOG_CACHE_KEY = 'ezzo_blog_cache_v1';
const BLOG_CACHE_MS = 10 * 60 * 1000;

const esc = s => { const d = document.createElement('div'); d.appendChild(document.createTextNode(String(s ?? ''))); return d.innerHTML; };

let allPosts = [];
const filters = { category: '', tool: '', q: '' };

// ── Data ───────────────────────────────────────────────────────────────
function mergePosts(remote) {
  const bySlug = new Map();
  (typeof BLOG_POSTS !== 'undefined' ? BLOG_POSTS : []).forEach(p => bySlug.set(p.slug, p));
  (remote || []).forEach(p => {
    if (!p || !p.slug || !p.title) return;
    if (p.status && p.status !== 'published') { bySlug.delete(p.slug); return; }  // unpublishing hides a seeded post too
    bySlug.set(p.slug, p);
  });
  return Array.from(bySlug.values())
    .filter(p => !p.status || p.status === 'published')
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

// JSONP, for the same reason the rest of the site uses it: Apps Script web
// apps cannot set CORS headers on their responses.
function fetchRemotePosts() {
  return new Promise(resolve => {
    const cb = 'ezzoBlogCb' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let settled = false;
    const finish = res => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window[cb] = function () {};   // a late response must not throw
      script.remove();
      resolve(res);
    };
    const timer = setTimeout(() => finish(null), 8000);
    window[cb] = res => finish(res && res.ok ? res.posts : null);
    script.src = `${BLOG_ENDPOINT}?action=posts&cb=${cb}&_=${Date.now()}`;
    script.onerror = () => finish(null);
    document.head.appendChild(script);
  });
}

// Cached so a reader clicking between posts doesn't refetch every time, and
// so the index still fills in if they're briefly offline.
function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(BLOG_CACHE_KEY) || 'null');
    if (raw && Array.isArray(raw.posts)) return raw;
  } catch (e) { /* corrupt cache is the same as no cache */ }
  return null;
}
function writeCache(posts) {
  try { localStorage.setItem(BLOG_CACHE_KEY, JSON.stringify({ at: Date.now(), posts })); } catch (e) { /* quota */ }
}

// ── Helpers ────────────────────────────────────────────────────────────
const catLabel = id => (BLOG_CATEGORIES.find(c => c.id === id) || {}).label || 'Guides';
const toolLabel = id => (BLOG_TOOLS.find(t => t.id === id) || {}).label || '';
const postUrl = slug => `/blog?p=${encodeURIComponent(slug)}`;

function fmtDate(iso) {
  const d = new Date(String(iso || '') + 'T00:00:00');
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function readTime(p) {
  if (p.readMinutes) return p.readMinutes;
  const words = String(p.body || '').replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 225));
}

function metaLine(p) {
  return `<div class="bl-meta">
    <span class="bl-cat-pill" data-cat="${esc(p.category)}">${esc(catLabel(p.category))}</span>
    <span>${esc(fmtDate(p.date))}</span>
    <span class="bl-dot">${readTime(p)} min read</span>
  </div>`;
}

function cardHtml(p) {
  return `<a class="bl-card" href="${postUrl(p.slug)}">
    <img class="bl-card-img" src="${esc(p.image || '')}" alt="${esc(p.imageAlt || p.title)}" loading="lazy" width="500" height="500">
    <div class="bl-card-body">
      ${metaLine(p)}
      <h3>${esc(p.title)}</h3>
      <p>${esc(p.excerpt || '')}</p>
    </div>
  </a>`;
}

// ── Index view ─────────────────────────────────────────────────────────
function visiblePosts() {
  const q = filters.q.trim().toLowerCase();
  return allPosts.filter(p => {
    if (filters.category && p.category !== filters.category) return false;
    if (filters.tool && p.tool !== filters.tool) return false;
    if (!q) return true;
    return [p.title, p.excerpt, (p.tags || []).join(' ')].some(v => String(v).toLowerCase().includes(q));
  });
}

function filterBarHtml() {
  // Only offer filters that would actually return something. An empty
  // "Wedding Planner" tab is a worse experience than no tab.
  const usedCats = new Set(allPosts.map(p => p.category));
  const usedTools = new Set(allPosts.map(p => p.tool));
  const cats = BLOG_CATEGORIES.filter(c => usedCats.has(c.id));
  const tools = BLOG_TOOLS.filter(t => usedTools.has(t.id));
  const chip = (val, cur, label, kind) =>
    `<button class="bl-chip${cur === val ? ' is-active' : ''}" data-${kind}="${esc(val)}" type="button">${esc(label)}</button>`;

  return `<div class="bl-filters">
    ${tools.length > 1 ? `<div class="bl-filter-row">
      <span class="bl-filter-label">Tool</span>
      ${chip('', filters.tool, 'All', 'tool')}
      ${tools.map(t => chip(t.id, filters.tool, t.label, 'tool')).join('')}
    </div>` : ''}
    <div class="bl-filter-row">
      <span class="bl-filter-label">Topic</span>
      ${chip('', filters.category, 'All', 'cat')}
      ${cats.map(c => chip(c.id, filters.category, c.label, 'cat')).join('')}
      <input class="bl-search" id="blSearch" type="search" placeholder="Search articles..." value="${esc(filters.q)}" aria-label="Search articles">
    </div>
  </div>`;
}

function renderIndex() {
  const posts = visiblePosts();
  const isDefaultView = !filters.category && !filters.tool && !filters.q;
  const featured = isDefaultView ? (posts.find(p => p.featured) || posts[0]) : null;
  const rest = featured ? posts.filter(p => p.slug !== featured.slug) : posts;

  document.title = 'Budgeting Guides & Money Advice | Ezzo Hub Blog';
  setMeta('description', 'Practical budgeting guides from Ezzo Hub: zero-based budgeting, debt payoff, sinking funds, no-spend challenges and real-world money systems that hold up.');
  setCanonical('https://ezzohub.com/blog');

  document.getElementById('blogRoot').innerHTML = `
    <header class="bl-hero">
      <h1>Money guides that survive<br><span class="grad-text">a real month</span></h1>
      <p>Practical, opinionated writing about budgeting, debt and the systems that actually hold up once life gets in the way. No jargon, no lectures.</p>
    </header>
    ${filterBarHtml()}
    ${featured ? `<a class="bl-featured" href="${postUrl(featured.slug)}">
      <img src="${esc(featured.image || '')}" alt="${esc(featured.imageAlt || featured.title)}" width="500" height="500">
      <div>
        ${metaLine(featured)}
        <h2>${esc(featured.title)}</h2>
        <p>${esc(featured.excerpt || '')}</p>
        <span class="btn btn-primary btn-sm">Read the guide</span>
      </div>
    </a>` : ''}
    ${posts.length
      ? `<div class="bl-grid">${rest.map(cardHtml).join('')}</div>`
      : `<div class="bl-empty"><strong>Nothing matches that yet.</strong>Try a different topic, or clear the search.</div>`}
  `;
  wireFilters();
}

function wireFilters() {
  // Scoped to the filter bar. The category pill on every card also carries a
  // data-cat (for its colour), so an unscoped selector would wire up twenty
  // extra elements and make clicking a card's pill change the filter.
  const bar = document.querySelector('.bl-filters');
  if (!bar) return;
  bar.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
    filters.category = b.dataset.cat; renderIndex();
  }));
  bar.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => {
    filters.tool = b.dataset.tool; renderIndex();
  }));
  const search = document.getElementById('blSearch');
  search?.addEventListener('input', e => {
    filters.q = e.target.value;
    const pos = e.target.selectionStart;
    renderIndex();
    const el = document.getElementById('blSearch');
    if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  });
}

// ── Article view ───────────────────────────────────────────────────────
function renderArticle(slug) {
  const p = allPosts.find(x => x.slug === slug);
  if (!p) {
    document.title = 'Article not found | Ezzo Hub Blog';
    document.getElementById('blogRoot').innerHTML = `
      <div class="bl-empty" style="padding-top:90px">
        <strong>We couldn't find that article.</strong>
        It may have been renamed or removed.
        <p style="margin-top:18px"><a class="btn btn-primary btn-sm" href="/blog">Back to all guides</a></p>
      </div>`;
    return;
  }

  const desc = p.excerpt || String(p.body || '').replace(/<[^>]+>/g, ' ').slice(0, 155);
  document.title = `${p.title} | Ezzo Hub`;
  setMeta('description', desc);
  setProp('og:title', p.title);
  setProp('og:description', desc);
  setProp('og:type', 'article');
  setProp('og:url', `https://ezzohub.com/blog?p=${p.slug}`);
  if (p.image) setProp('og:image', `https://ezzohub.com/${String(p.image).replace(/^\//, '')}`);
  setCanonical(`https://ezzohub.com/blog?p=${p.slug}`);
  setArticleSchema(p, desc);

  const related = (p.related || [])
    .map(s => allPosts.find(x => x.slug === s))
    .filter(Boolean)
    .slice(0, 3);

  document.getElementById('blogRoot').innerHTML = `
    <article class="bl-article">
      <a class="bl-back" href="/blog">&larr; All guides</a>
      ${metaLine(p)}
      <h1>${esc(p.title)}</h1>
      <p class="bl-article-lede">${esc(p.excerpt || '')}</p>
      ${p.image ? `<img class="bl-hero-img" src="${esc(p.image)}" alt="${esc(p.imageAlt || p.title)}" width="500" height="500">` : ''}
      <div class="bl-body">${p.body || ''}</div>
      ${(p.tags || []).length ? `<div class="bl-tags">${p.tags.map(t => `<span class="bl-tag">${esc(t)}</span>`).join('')}</div>` : ''}

      <div class="bl-cta">
        <h3>Put this into practice tonight</h3>
        <p>Ezzo Budget is a one-payment budgeting app with no bank login and no subscription. Try the free version first and see whether it fits how you actually handle money.</p>
        <div class="bl-cta-btns">
          <a class="btn btn-primary" href="/budgetplanner">Try Ezzo Budget free</a>
          <a class="btn btn-ghost" href="/ultimate-budget">See the Ultimate planner</a>
        </div>
      </div>

      ${related.length ? `<section class="bl-related">
        <h2>Keep reading</h2>
        <div class="bl-related-grid">${related.map(cardHtml).join('')}</div>
      </section>` : ''}
    </article>`;
  window.scrollTo(0, 0);
}

// ── Head tag helpers ───────────────────────────────────────────────────
function setMeta(name, content) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
  el.setAttribute('content', content);
}
function setProp(prop, content) {
  let el = document.querySelector(`meta[property="${prop}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
  el.setAttribute('content', content);
}
function setCanonical(href) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) { el = document.createElement('link'); el.rel = 'canonical'; document.head.appendChild(el); }
  el.setAttribute('href', href);
}
function setArticleSchema(p, desc) {
  document.getElementById('blogArticleSchema')?.remove();
  const s = document.createElement('script');
  s.type = 'application/ld+json';
  s.id = 'blogArticleSchema';
  s.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: p.title,
    description: desc,
    datePublished: p.date,
    dateModified: p.updated || p.date,
    image: p.image ? `https://ezzohub.com/${String(p.image).replace(/^\//, '')}` : undefined,
    author: { '@type': 'Organization', name: 'Ezzo Hub', url: 'https://ezzohub.com/' },
    publisher: { '@type': 'Organization', name: 'Ezzo Hub', url: 'https://ezzohub.com/' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `https://ezzohub.com/blog?p=${p.slug}` }
  });
  document.head.appendChild(s);
}

// ── Routing ────────────────────────────────────────────────────────────
function currentSlug() { return new URLSearchParams(location.search).get('p') || ''; }

function route() {
  const slug = currentSlug();
  if (slug) renderArticle(slug); else renderIndex();
}

// Internal links are intercepted so moving between posts doesn't reload the
// page. Anything else (the apps, external links) is left alone.
document.addEventListener('click', e => {
  const a = e.target.closest?.('a');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const href = a.getAttribute('href') || '';
  if (!/^\/blog(\?|$)/.test(href)) return;
  e.preventDefault();
  history.pushState({}, '', href);
  route();
});
window.addEventListener('popstate', route);

(async function init() {
  const cached = readCache();
  allPosts = mergePosts(cached ? cached.posts : null);
  route();
  trackEvent?.('page_view', { section: 'blog', slug: currentSlug() });

  // Refresh in the background. The page is already usable, so a slow or
  // failed call costs the reader nothing.
  if (!cached || Date.now() - cached.at > BLOG_CACHE_MS) {
    const remote = await fetchRemotePosts();
    if (remote) {
      writeCache(remote);
      allPosts = mergePosts(remote);
      route();
    }
  }
})();
