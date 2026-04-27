/**
 * Alt Cloud Checker — Service Worker (Manifest V3)
 *
 * Network footprint: exactly one outbound request — fetching clouds.json from
 * www.alt-cloud.org. Nothing else leaves the extension. No telemetry. No analytics.
 * The "Suggest" flow opens a prefilled GitHub URL; the user submits it manually.
 *
 * States
 * ------
 * green  — listed, meets all 3 criteria
 * yellow — listed, meets 2 of 3 criteria
 * watch  — tracked as Future Cloud (Emerging & Unverified Providers)
 * plus   — not listed; plausible candidate
 * home   — this IS alt-cloud.org (show info, no suggest/report actions)
 * grey   — unchecked (internal pages, platform denylist, dismissed, error)
 */

const CLOUDS_URL = 'https://www.alt-cloud.org/clouds.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Category that maps to the Future Cloud / watch state
const FUTURE_CATEGORY = 'Emerging & Unverified Providers';

// Platforms where we stay grey and don't badge proactively
const PLATFORM_DENYLIST = new Set([
  'github.com', 'gitlab.com', 'bitbucket.org', 'gitea.com',
  'twitter.com', 'x.com', 'linkedin.com', 'facebook.com', 'instagram.com',
  'youtube.com', 'reddit.com', 'stackoverflow.com', 'stackexchange.com',
  'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'perplexity.ai',
  'news.ycombinator.com', 'medium.com', 'substack.com', 'dev.to', 'hashnode.com',
  'wikipedia.org', 'notion.so', 'confluence.atlassian.com', 'atlassian.com',
  'slack.com', 'discord.com', 'zoom.us', 'loom.com',
  'npmjs.com', 'pypi.org', 'crates.io', 'pkg.go.dev',
  'producthunt.com', 'crunchbase.com', 'techcrunch.com', 'theverge.com',
  'localhost',
]);

const ICONS = {
  grey:   { 16: 'icons/icon-grey-16.png',   48: 'icons/icon-grey-48.png',   128: 'icons/icon-grey-128.png' },
  green:  { 16: 'icons/icon-green-16.png',  48: 'icons/icon-green-48.png',  128: 'icons/icon-green-128.png' },
  yellow: { 16: 'icons/icon-yellow-16.png', 48: 'icons/icon-yellow-48.png', 128: 'icons/icon-yellow-128.png' },
  watch:  { 16: 'icons/icon-watch-16.png',  48: 'icons/icon-watch-48.png',  128: 'icons/icon-watch-128.png' },
  plus:   { 16: 'icons/icon-plus-16.png',   48: 'icons/icon-plus-48.png',   128: 'icons/icon-plus-128.png' },
};

// ---------------------------------------------------------------------------
// Domain normalization
// ---------------------------------------------------------------------------

function normalizeDomain(input) {
  try {
    let url = input;
    if (!url.includes('://')) url = 'https://' + url;
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Extract registrable domain (foo.com from docs.foo.com).
 * Simple two-label approach; handles common ccTLD second-levels (co.uk, co.jp).
 */
function registrableDomain(hostname) {
  if (!hostname) return null;
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const sld = parts[parts.length - 2];
  const commonShortSLDs = ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or'];
  if (sld.length <= 3 && commonShortSLDs.includes(sld)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function isInternalUrl(url) {
  if (!url) return true;
  return ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'moz-extension://']
    .some(prefix => url.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Data enrichment
// ---------------------------------------------------------------------------

/**
 * Derive fields the extension needs from the existing clouds.json schema.
 * Avoids requiring pipeline changes for the MVP.
 */
function enrichEntry(entry) {
  const domain = normalizeDomain(entry.url);
  const isFuture = (entry.categories || []).includes(FUTURE_CATEGORY);

  // Per-criterion breakdown.
  // score=3 → all three met; score=2 → we know two are met but not which is missing.
  // Marking all three as 'unknown' for score=2 is honest — never round up.
  const criteria = entry.score === 3
    ? {
        transparent_public_pricing: 'met',
        usage_based_self_service:   'met',
        production_indicators:      'met',
      }
    : {
        transparent_public_pricing: 'unknown',
        usage_based_self_service:   'unknown',
        production_indicators:      'unknown',
      };

  // Category anchor for deep-linking to alt-cloud.org
  const primaryCategory = (entry.categories || [])[0] || '';
  const anchor = primaryCategory.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return {
    ...entry,
    domain,
    tier:    isFuture ? 'future' : 'full',
    status:  entry.score === 3 ? 'green' : 'yellow',
    criteria,
    aliases: entry.aliases || [],
    anchor,
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

async function getClouds() {
  const now = Date.now();
  const stored = await chrome.storage.local.get(['clouds', 'cloudsTimestamp']);

  if (stored.clouds && stored.cloudsTimestamp && now - stored.cloudsTimestamp < CACHE_TTL_MS) {
    return stored.clouds;
  }

  try {
    const response = await fetch(CLOUDS_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    const clouds = raw.map(enrichEntry);
    await chrome.storage.local.set({ clouds, cloudsTimestamp: now });
    return clouds;
  } catch (err) {
    console.warn('[AltCloud] fetch failed:', err.message);
    return stored.clouds ?? null;
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function findEntry(clouds, tabUrl) {
  if (!clouds || !tabUrl) return null;
  const tabHost = registrableDomain(normalizeDomain(tabUrl));
  if (!tabHost) return null;

  return clouds.find(entry => {
    if (!entry.domain) return false;
    const entryHost = registrableDomain(entry.domain);
    if (entryHost === tabHost) return true;
    for (const alias of (entry.aliases || [])) {
      if (registrableDomain(normalizeDomain(alias)) === tabHost) return true;
    }
    return false;
  }) ?? null;
}

async function computeState(tabUrl, clouds) {
  if (isInternalUrl(tabUrl)) return 'grey';
  if (!clouds) return 'grey';

  const domain = normalizeDomain(tabUrl);
  if (!domain) return 'grey';

  // alt-cloud.org itself — special home state, no suggest/report actions
  if (registrableDomain(domain) === 'alt-cloud.org') return 'home';

  if (PLATFORM_DENYLIST.has(registrableDomain(domain))) return 'grey';

  // Check local dismiss list
  const { dismissed = [] } = await chrome.storage.local.get('dismissed');
  if (dismissed.includes(registrableDomain(domain))) return 'grey';

  const entry = findEntry(clouds, tabUrl);
  if (!entry) return 'plus';
  if (entry.tier === 'future') return 'watch';
  return entry.status === 'green' ? 'green' : 'yellow';
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

const BADGE_CONFIG = {
  green:  { text: '✓', color: '#1a7f37' },
  yellow: { text: '!', color: '#9a6700' },
  watch:  { text: '·', color: '#0550ae' },
  plus:   { text: '+', color: '#57606a' },
  grey:   { text: '',  color: '#8c959f' },
};

async function applyBadge(tabId, state) {
  await chrome.action.setIcon({ tabId, path: ICONS[state] ?? ICONS.grey });
  const b = BADGE_CONFIG[state] ?? BADGE_CONFIG.grey;
  await chrome.action.setBadgeText({ tabId, text: b.text });
  if (b.text) await chrome.action.setBadgeBackgroundColor({ tabId, color: b.color });
}

async function updateTab(tabId, tabUrl) {
  try {
    const clouds = await getClouds();
    const state = await computeState(tabUrl, clouds);
    await applyBadge(tabId, state);
  } catch (err) {
    console.warn('[AltCloud] updateTab error:', err.message);
    await applyBadge(tabId, 'grey');
  }
}

// ---------------------------------------------------------------------------
// Tab listeners
// ---------------------------------------------------------------------------

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await updateTab(tabId, tab.url);
  } catch { /* tab may have been closed */ }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    await updateTab(tabId, tab.url);
  }
});

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.type === 'GET_STATE') {
    (async () => {
      const clouds = await getClouds();
      const state = await computeState(msg.url, clouds);
      const entry = findEntry(clouds, msg.url);
      const { cloudsTimestamp } = await chrome.storage.local.get('cloudsTimestamp');
      sendResponse({
        state,
        entry: entry ?? null,
        cloudsLoaded: !!clouds,
        cloudsCount: clouds?.length ?? 0,
        cachedAt: cloudsTimestamp ?? null,
      });
    })();
    return true;
  }

  if (msg.type === 'REFRESH_CACHE') {
    (async () => {
      await chrome.storage.local.remove(['clouds', 'cloudsTimestamp']);
      const clouds = await getClouds();
      sendResponse({ ok: !!clouds, count: clouds?.length ?? 0 });
    })();
    return true;
  }

  if (msg.type === 'DISMISS_DOMAIN') {
    (async () => {
      const { dismissed = [] } = await chrome.storage.local.get('dismissed');
      if (!dismissed.includes(msg.domain)) {
        dismissed.push(msg.domain);
        await chrome.storage.local.set({ dismissed });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});
