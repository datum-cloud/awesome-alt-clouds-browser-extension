/**
 * Alt Cloud Checker — Popup
 *
 * Renders one of six states based on the current tab's domain:
 *   green  — listed, all 3 criteria met
 *   yellow — listed, 2 of 3 criteria met
 *   watch  — Future Cloud (on the watch list)
 *   plus   — not listed; suggest flow
 *   home   — this IS alt-cloud.org; no suggest/report actions
 *   grey   — unchecked (internal pages, platform denylist, dismissed)
 *
 * Data read from the page (via chrome.scripting.executeScript):
 *   document.title, <meta og:*> tags, favicon href, location.hostname
 * Nothing is transmitted off-device. Clicking "Suggest" opens a prefilled
 * GitHub issue URL in a new tab; the user reviews and submits manually.
 */

'use strict';

const DIRECTORY_URL = 'https://www.alt-cloud.org/';
const GITHUB_ISSUES_URL = 'https://github.com/datum-cloud/awesome-alt-clouds/issues/new';

const CRITERIA_META = [
  {
    key:   'transparent_public_pricing',
    label: 'Transparent public pricing',
    desc:  'Prices visible without signing up or contacting sales',
  },
  {
    key:   'usage_based_self_service',
    label: 'Usage-based self-service',
    desc:  'Self-service signup; no sales call required',
  },
  {
    key:   'production_indicators',
    label: 'Production indicators',
    desc:  'Public SLA, status page, or uptime tracker',
  },
];

// ---------------------------------------------------------------------------
// View management
// ---------------------------------------------------------------------------

const VIEW_IDS = ['loading', 'error', 'unchecked', 'home', 'green', 'yellow', 'watch', 'plus'];

function showView(name) {
  for (const id of VIEW_IDS) {
    document.getElementById(`view-${id}`)?.classList.toggle('hidden', id !== name);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openTab(url) {
  chrome.tabs.create({ url });
  window.close();
}

function categoryToSlug(cat) {
  return cat.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url;
  }
}

function registrableDomain(hostname) {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const sld = parts[parts.length - 2];
  const commonShortSLDs = ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or'];
  if (sld.length <= 3 && commonShortSLDs.includes(sld)) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

function formatCacheAge(ts) {
  if (!ts) return 'no data';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

// ---------------------------------------------------------------------------
// Page metadata extraction (content script)
// ---------------------------------------------------------------------------

async function getPageMeta(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const og = (name) =>
          document.querySelector(`meta[property="og:${name}"]`)?.content ||
          document.querySelector(`meta[name="og:${name}"]`)?.content || '';
        const favicon = () => {
          const link =
            document.querySelector('link[rel="icon"]') ||
            document.querySelector('link[rel="shortcut icon"]') ||
            document.querySelector('link[rel~="icon"]');
          if (!link) return `${location.origin}/favicon.ico`;
          const href = link.getAttribute('href');
          return href.startsWith('http') ? href : new URL(href, location.origin).href;
        };
        return {
          title:       og('title') || document.title || location.hostname,
          description: og('description') ||
                       document.querySelector('meta[name="description"]')?.content || '',
          siteName:    og('site_name') || '',
          favicon:     favicon(),
          hostname:    location.hostname.replace(/^www\./, ''),
          url:         location.href,
        };
      },
    });
    return result?.result ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Criteria block renderer
// ---------------------------------------------------------------------------

function buildCriteriaBlock(criteria, score) {
  const statusIcon = {
    met:     '✅',
    unmet:   '❌',
    unknown: '❔',
  };
  const statusClass = {
    met:     '',
    unmet:   'missing',
    unknown: 'unknown',
  };

  const metCount = Object.values(criteria).filter(v => v === 'met').length;
  const unmetKeys = Object.entries(criteria)
    .filter(([, v]) => v === 'unmet')
    .map(([k]) => k);

  // For 2/3 entries where per-criterion data is unavailable (all 'unknown'),
  // show a clear note rather than three ❔ rows.
  const allUnknown = Object.values(criteria).every(v => v === 'unknown');
  if (allUnknown && score === 2) {
    return `
      <div class="criteria-block">
        <div class="criterion-row">
          <span class="criterion-icon">❔</span>
          <span class="criterion-label unknown">Meets 2 of 3 criteria — specific gap not tracked in current data</span>
        </div>
        ${CRITERIA_META.map(c => `
          <div class="criterion-row">
            <span class="criterion-icon">❔</span>
            <span class="criterion-label unknown">${esc(c.label)}</span>
          </div>
        `).join('')}
        <div class="criteria-summary">Per-criterion breakdown will improve in a future data update.</div>
      </div>`;
  }

  const rows = CRITERIA_META.map(c => {
    const status = criteria[c.key] ?? 'unknown';
    const cls = statusClass[status] || '';
    return `
      <div class="criterion-row">
        <span class="criterion-icon">${statusIcon[status]}</span>
        <span class="criterion-label ${cls}" title="${esc(c.desc)}">${esc(c.label)}</span>
      </div>`;
  }).join('');

  let summary = '';
  if (unmetKeys.length > 0) {
    const missing = unmetKeys.map(k => CRITERIA_META.find(c => c.key === k)?.label).filter(Boolean);
    summary = `<div class="criteria-summary">Missing: ${esc(missing.join(', '))}</div>`;
  } else if (allUnknown) {
    summary = `<div class="criteria-summary">Meets ${score ?? '?'} of 3 — per-criterion detail unavailable</div>`;
  }

  return `<div class="criteria-block">${rows}${summary}</div>`;
}

// ---------------------------------------------------------------------------
// Issue URL builder
// ---------------------------------------------------------------------------

/**
 * Submission issue — matches the body format produced by alt-cloud.org/submit/
 * so the existing evaluate-submission.yml workflow picks it up automatically.
 *
 * Example (issue #172):
 *   ## Cloud Service Submission
 *   ### URLs
 *   1. https://infron.ai/
 *   **Submitter:** Jacob Smith
 *   **Submitted:** 2026-04-25T21:59:55.524Z
 *   **Count:** 1
 *   ### Notes
 *   No additional notes provided.
 */
function buildIssueUrl(meta) {
  const title = `[Submission] ${meta.url}`;
  const body = [
    '## Cloud Service Submission',
    '',
    '### URLs',
    `1. ${meta.url}`,
    '',
    '**Submitter:** Anonymous',
    `**Submitted:** ${new Date().toISOString()}`,
    '**Count:** 1',
    '',
    '### Notes',
    'No additional notes provided.',
    '',
    '---',
    '*This issue was automatically created via the submission form. A GitHub Action will evaluate each service and use AI to generate name, description, and category. Services that pass (2/3 or 3/3 criteria) will be added to a PR.*',
  ].join('\n');

  return `${GITHUB_ISSUES_URL}?` + new URLSearchParams({
    title,
    body,
    labels: 'submission',
  }).toString();
}

function buildReportUrl(entry, tab) {
  const title = `[Correction] ${entry.name}`;
  const body = [
    '## Correction Report',
    '',
    `**Listing:** [${entry.name}](${entry.url})`,
    `**Reported from:** ${tab?.url || entry.url}`,
    '',
    '**What needs correcting:**',
    '',
    '**Evidence (link or description):**',
    '',
    '---',
    '*Reported via the Alt Cloud browser extension.*',
  ].join('\n');
  return `${GITHUB_ISSUES_URL}?` + new URLSearchParams({
    title,
    body,
    labels: 'correction',
  }).toString();
}

function buildGraduateUrl(entry) {
  const title = `[Graduation] ${entry.name}`;
  const body = [
    '## Graduation Request',
    '',
    `**Service:** [${entry.name}](${entry.url})`,
    '',
    '**Why they should graduate from Future Cloud to full listing:**',
    '',
    '**Evidence of criteria now met:**',
    '',
    '---',
    '*Reported via the Alt Cloud browser extension.*',
  ].join('\n');
  return `${GITHUB_ISSUES_URL}?` + new URLSearchParams({
    title,
    body,
    labels: 'graduation',
  }).toString();
}

// ---------------------------------------------------------------------------
// State renderers
// ---------------------------------------------------------------------------

function renderListed(state, entry, tab) {
  showView(state);
  const prefix = state; // 'green' or 'yellow'

  document.getElementById(`${prefix}-name`).textContent = entry.name;
  document.getElementById(`${prefix}-desc`).textContent = entry.description;

  const category = (entry.categories || [])[0] || 'Uncategorized';
  const catEl = document.getElementById(`${prefix}-cat`);
  catEl.textContent = category;
  catEl.href = `${DIRECTORY_URL}#${categoryToSlug(category)}`;

  document.getElementById(`${prefix}-criteria`).innerHTML =
    buildCriteriaBlock(entry.criteria, entry.score);

  document.getElementById(`${prefix}-view`).addEventListener('click', () => {
    openTab(`${DIRECTORY_URL}?search=${encodeURIComponent(entry.name)}`);
  });

  document.getElementById(`${prefix}-report`).addEventListener('click', () => {
    openTab(buildReportUrl(entry, tab));
  });
}

function renderWatch(entry, tab) {
  showView('watch');
  document.getElementById('watch-name').textContent = entry.name;
  document.getElementById('watch-desc').textContent = entry.description;
  document.getElementById('watch-criteria').innerHTML =
    buildCriteriaBlock(entry.criteria, entry.score);

  document.getElementById('watch-graduate').addEventListener('click', () => {
    openTab(buildGraduateUrl(entry));
  });
}

async function renderPlus(tab) {
  showView('plus');

  const meta = await getPageMeta(tab.id) ?? {
    title: tab.title || tab.url,
    hostname: normalizeDomain(tab.url),
    url: tab.url,
    description: '',
  };

  const metaEl = document.getElementById('plus-meta');
  metaEl.innerHTML = `
    <div class="meta-row">
      <span class="meta-label">Domain</span>
      <span class="meta-value">${esc(meta.hostname)}</span>
    </div>
    <div class="meta-row">
      <span class="meta-label">Title</span>
      <span class="meta-value" title="${esc(meta.title)}">${esc(meta.title)}</span>
    </div>`;

  document.getElementById('btn-suggest').addEventListener('click', () => {
    openTab(buildIssueUrl(meta));
  });

}

function renderHome(cloudsCount) {
  showView('home');
  const countEl = document.getElementById('home-count');
  if (countEl && cloudsCount) countEl.textContent = cloudsCount;
}

function renderUnchecked(forceCheckAvailable, tab) {
  showView('unchecked');
  if (forceCheckAvailable && tab) {
    document.getElementById('btn-force-check').addEventListener('click', async () => {
      const { state, entry } = await chrome.runtime.sendMessage({
        type: 'GET_STATE',
        url: tab.url,
      });
      if (state === 'plus') await renderPlus(tab);
      else window.close();
    });
  } else {
    document.getElementById('btn-force-check').style.display = 'none';
  }
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function setupFooter(cachedAt) {
  document.getElementById('footer-home').addEventListener('click', e => {
    e.preventDefault();
    openTab(DIRECTORY_URL);
  });

  const cacheEl = document.getElementById('footer-cache');
  cacheEl.textContent = cachedAt ? `Updated ${formatCacheAge(cachedAt)}` : 'No data';

  const refreshEl = document.getElementById('footer-refresh');
  refreshEl.addEventListener('click', async e => {
    e.preventDefault();
    refreshEl.textContent = 'Refreshing…';
    refreshEl.style.pointerEvents = 'none';
    try {
      const res = await chrome.runtime.sendMessage({ type: 'REFRESH_CACHE' });
      refreshEl.textContent = res?.ok ? `${res.count} listings` : 'Failed';
      if (res?.ok) cacheEl.textContent = 'Updated just now';
    } catch {
      refreshEl.textContent = 'Failed';
    }
    setTimeout(() => {
      refreshEl.textContent = 'Refresh';
      refreshEl.style.pointerEvents = '';
    }, 2500);
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    showView('error');
    document.getElementById('error-msg').textContent = 'Could not access the current tab.';
    return;
  }

  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: 'GET_STATE', url: tab?.url });
  } catch {
    showView('error');
    document.getElementById('error-msg').textContent = 'Extension error. Try reloading.';
    return;
  }

  setupFooter(response?.cachedAt ?? null);

  if (!response?.cloudsLoaded) {
    showView('error');
    document.getElementById('error-msg').textContent =
      'Could not load Alt Cloud data. Check your connection and try refreshing.';
    document.getElementById('btn-retry').addEventListener('click', () => window.location.reload());
    return;
  }

  const { state, entry } = response;

  switch (state) {
    case 'green':
      renderListed('green', entry, tab);
      break;
    case 'yellow':
      renderListed('yellow', entry, tab);
      break;
    case 'watch':
      renderWatch(entry, tab);
      break;
    case 'plus':
      await renderPlus(tab);
      break;
    case 'home':
      renderHome(response.cloudsCount);
      break;
    case 'grey':
    default:
      renderUnchecked(!!tab?.url, tab);
      break;
  }
});
