// JobTrackr Popup
// All references to DB/Helpers are deferred until init() to avoid crash if scripts load late.

let allApps = [];
let searchQuery = '';
let hideRejected = true; // default: hide rejected applications on first glance

// Interview-stage statuses get pinned to the top and highlighted.
const HOT_STATUSES = ['Phone Screen', 'Technical', 'Final Round'];
const isHot = (status) => HOT_STATUSES.includes(status);

// ── Initialization ─────────────────────────────────────────────────────────
async function init() {
  const DB = window.JobTrackrDB;
  const H = window.JobTrackrHelpers;

  if (!DB || !H) {
    console.error('JobTrackr: DB or Helpers not loaded');
    return;
  }

  await loadApps(DB, H);
  await checkStorage(DB);
  await initAtsMatch(DB);
  bindEvents(DB, H);

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function loadApps(DB, H) {
  try {
    allApps = await DB.getAllApplications();
  } catch (e) {
    console.error('JobTrackr: loadApps error', e);
    allApps = [];
  }
  allApps.sort((a, b) => {
    const ha = isHot(a.status), hb = isHot(b.status);
    if (ha !== hb) return ha ? -1 : 1;           // interview-stage jobs first
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  renderStats(H);
  updateRejectedBadgeCount();
  renderList(filterApps(), H);
}

function filterApps() {
  let apps = [...allApps].filter((a) => a.archived !== true);
  if (hideRejected) {
    apps = apps.filter((a) => a.status !== 'Rejected');
  }
  if (!searchQuery) return apps.slice(0, 20);
  const q = searchQuery.toLowerCase();
  return apps
    .filter((a) => (a.jobTitle + ' ' + a.company).toLowerCase().includes(q))
    .slice(0, 20);
}

async function checkStorage(DB) {
  try {
    const quota = await DB.checkStorageQuota();
    if (quota.warning) {
      const el = document.getElementById('storageWarning');
      document.getElementById('storageWarningText').textContent =
        `Storage ${quota.percent}% full — consider exporting and clearing old entries.`;
      el.style.display = 'flex';
    }
  } catch (e) {
    // Non-critical
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────
function renderStats(H) {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const total = allApps.length;
  const thisWeek = allApps.filter((a) => new Date(a.createdAt).getTime() > weekAgo).length;
  const interviews = allApps.filter((a) =>
    ['Phone Screen', 'Technical', 'Final Round'].includes(a.status)
  ).length;
  const offers = allApps.filter((a) => a.status === 'Offer').length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statWeek').textContent = thisWeek;
  document.getElementById('statInterviews').textContent = interviews;
  document.getElementById('statOffers').textContent = offers;
}

// ── List Rendering ─────────────────────────────────────────────────────────
function renderList(apps, H) {
  const container = document.getElementById('appList');
  const empty = document.getElementById('emptyState');

  // Clear existing cards
  container.querySelectorAll('.app-card').forEach((el) => el.remove());

  if (apps.length === 0) {
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  for (const app of apps) {
    container.appendChild(createCard(app, H));
  }
}

function createCard(app, H) {
  const { STATUS_CONFIG, PLATFORM_CONFIG, timeAgo } = H;
  const card = document.createElement('div');
  card.className = 'app-card' + (isHot(app.status) ? ' app-card--hot' : '');
  card.dataset.id = app.id;

  const statusCfg = STATUS_CONFIG[app.status] || STATUS_CONFIG['Applied'];
  const platformKey = (app.platform || 'other').toLowerCase();
  const platformCfg = PLATFORM_CONFIG[platformKey] || PLATFORM_CONFIG['other'];
  const dateStr = app.dateApplied || app.dateFirstSeen || app.createdAt;

  card.innerHTML = `
    <div class="app-card-top">
      <div class="app-card-info">
        <div class="app-company">${escapeHtml(app.company || 'Unknown Company')}</div>
        <div class="app-title">${escapeHtml(app.jobTitle || 'Unknown Position')}</div>
      </div>
      <div class="app-card-actions">
        <span class="badge" style="color:${statusCfg.color};background:${statusCfg.bg}">
          ${escapeHtml(statusCfg.label)}
        </span>
        <button class="btn-delete-card" title="Delete this application" data-id="${app.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="app-card-bottom">
      <div class="app-meta">
        <span class="badge" style="color:${platformCfg.color};background:${platformCfg.bg}">
          ${escapeHtml(platformCfg.label)}
        </span>
        <span class="app-date">${timeAgo(dateStr)}</span>
      </div>
      <select class="status-select" title="Change status">
        ${Object.keys(STATUS_CONFIG).map((s) =>
          `<option value="${s}"${s === app.status ? ' selected' : ''}>${s}</option>`
        ).join('')}
      </select>
    </div>
  `;

  // Delete button
  const delBtn = card.querySelector('.btn-delete-card');
  delBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${app.jobTitle || 'this application'}" at ${app.company || 'Unknown'}?`)) return;
    try {
      await window.JobTrackrDB.deleteApplication(app.id);
      await loadApps(window.JobTrackrDB, window.JobTrackrHelpers);
    } catch (err) {
      console.error('Delete error', err);
    }
  });

  // Status quick-edit
  const select = card.querySelector('.status-select');
  select.addEventListener('change', async (e) => {
    e.stopPropagation();
    try {
      await window.JobTrackrDB.updateApplicationStatus(app.id, e.target.value, 'Status changed from popup');
      await loadApps(window.JobTrackrDB, window.JobTrackrHelpers);
    } catch (err) {
      console.error('Status update error', err);
    }
  });

  // Open dashboard detail on card click
  card.addEventListener('click', (e) => {
    if (e.target === select || e.target.tagName === 'OPTION') return;
    if (e.target.closest('.btn-delete-card')) return;
    chrome.tabs.create({
      url: chrome.runtime.getURL('dashboard/dashboard.html') + '?id=' + app.id,
    });
  });

  return card;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ── Events ─────────────────────────────────────────────────────────────────
function bindEvents(DB, H) {
  // Dashboard button
  document.getElementById('openDashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });

  // Search
  const searchInput = document.getElementById('searchInput');
  let searchTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = e.target.value.trim();
      renderList(filterApps(), H);
    }, 200);
  });

  // Custom Resume AI button
  document.getElementById('createCustomResume').addEventListener('click', () => openAiChat(DB));

  // Toggle Rejected applications
  const toggleBtn = document.getElementById('toggleRejected');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      hideRejected = !hideRejected;
      const iconContainer = document.getElementById('toggleRejectedIcon');
      if (hideRejected) {
        toggleBtn.title = 'Show Rejected Applications (Currently Hidden)';
        iconContainer.innerHTML = `
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        `;
        toggleBtn.classList.remove('active');
      } else {
        toggleBtn.title = 'Hide Rejected Applications (Currently Shown)';
        iconContainer.innerHTML = `
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        `;
        toggleBtn.classList.add('active');
      }
      renderList(filterApps(), H);
    });
  }

  // Manual entry modal
  document.getElementById('addManual').addEventListener('click', openModal);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('modalSave').addEventListener('click', () => saveManualEntry(DB, H));
}

function openModal() {
  document.getElementById('modalOverlay').style.display = 'flex';
  document.getElementById('mJobTitle').focus();
}

function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
  document.getElementById('modalError').style.display = 'none';
  ['mJobTitle', 'mCompany', 'mUrl', 'mLocation', 'mNotes'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  document.getElementById('mPlatform').value = 'other';
  document.getElementById('mStatus').value = 'Applied';
}

async function saveManualEntry(DB, H) {
  const jobTitle = document.getElementById('mJobTitle').value.trim();
  const company = document.getElementById('mCompany').value.trim();
  const platform = document.getElementById('mPlatform').value;
  const status = document.getElementById('mStatus').value;
  const url = document.getElementById('mUrl').value.trim();
  const location = document.getElementById('mLocation').value.trim();
  const notes = document.getElementById('mNotes').value.trim();

  const errorEl = document.getElementById('modalError');

  if (!jobTitle || !company) {
    errorEl.textContent = 'Job Title and Company are required.';
    errorEl.style.display = 'block';
    return;
  }

  errorEl.style.display = 'none';
  const btn = document.getElementById('modalSave');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const now = new Date().toISOString();
    await DB.addApplication({
      jobTitle,
      company,
      platform,
      applicationUrl: url,
      location,
      notes,
      status,
      dateFirstSeen: now,
      dateApplied: now,
      statusHistory: [{ status, date: now, note: 'Added manually' }],
      detectedAutomatically: false,
    });
    closeModal();
    await loadApps(DB, H);
  } catch (e) {
    errorEl.textContent = 'Error saving: ' + e.message;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Application';
  }
}

// ── AI Custom Resume ───────────────────────────────────────────────────────
async function openAiChat(DB) {
  const btn = document.getElementById('createCustomResume');
  btn.disabled = true;
  const originalTitle = btn.title || 'Custom Resume';
  btn.title = 'Extracting job description…';
  btn.style.color = 'var(--warning)';
  btn.style.borderColor = 'var(--warning)';

  try {
    const settings = await DB.getSettings();

    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab');

    // Extract job description from the active tab via scripting
    let jdText = '';
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const JD_KEYWORDS = [
            'responsibilities','qualifications','requirements','what you\'ll do',
            'what you will do','who you are','about the role','about this role',
            'minimum qualifications','preferred qualifications','years of experience',
            'you will','we are looking','the ideal candidate','skills required',
            'key skills','job description','position summary','essential functions',
            'education required','compensation','salary','benefits','what we offer',
          ];
          const NOISE_PHRASES = [
            'cookie','accept all','reject all','privacy policy','terms of use',
            'sign in','log in','create account','language','modify cookie',
            'functional cookies','optional cookies','gdpr','data protection',
          ];
          function jdScore(text) {
            const lower = text.toLowerCase();
            let score = 0;
            for (const kw of JD_KEYWORDS) { if (lower.includes(kw)) score += 15; }
            score += Math.min(text.length / 80, 60);
            let noiseHits = 0;
            for (const ph of NOISE_PHRASES) { if (lower.includes(ph)) noiseHits++; }
            score -= noiseHits * 25;
            const lines = text.split('\n').filter(l => l.trim().length > 0);
            const avgLineLen = text.length / Math.max(lines.length, 1);
            if (avgLineLen < 20) score -= 40;
            return score;
          }

          // Explicit high-confidence selectors
          const EXPLICIT = [
            '[data-automation-id*="jobPostingDescription"]',
            '[data-automation-id*="job-description"]',
            '.jobs-description__content', '.jobs-description-content__text',
            '#jobDescriptionText', '.jobsearch-JobComponent-description',
            '#job-details', '.jobDescriptionContent', '[class*="jobDescriptionContent"]',
            '[class*="job-description-body"]', '.xt-jd', '.xtJD',
            '[data-automation="job-description"]',
            '#content', '.job__description', '.posting-description', '.job-sections',
            '.job-description', '#job-description',
            '[class*="job-description"]', '[class*="jobDescription"]',
            '[id*="job-description"]', '[id*="jobDescription"]', 'article',
          ];
          for (const sel of EXPLICIT) {
            try {
              const el = document.querySelector(sel);
              if (!el) continue;
              const text = el.innerText.trim();
              if (text.length > 300 && jdScore(text) > 0) return text.slice(0, 9000);
            } catch {}
          }

          // Score all block elements and pick the best
          let bestEl = null, bestScore = -Infinity;
          for (const el of document.querySelectorAll('div, section, article, main')) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            if (el.closest('nav, header, footer, [role="navigation"]')) continue;
            const text = el.innerText.trim();
            if (text.length < 300) continue;
            const score = jdScore(text);
            if (score > bestScore) { bestScore = score; bestEl = el; }
          }
          if (bestEl && bestScore > 10) return bestEl.innerText.trim().slice(0, 9000);
          return '';
        },
      });
      jdText = results?.[0]?.result || '';
    } catch (e) {
      // scripting may fail on restricted pages (chrome://, etc.)
    }

    if (!jdText || jdText.length < 100) {
      btn.title = 'No job description found on this page';
      btn.style.color = 'var(--danger)';
      btn.style.borderColor = 'var(--danger)';
      setTimeout(() => {
        btn.disabled = false;
        btn.title = originalTitle;
        btn.style.color = '';
        btn.style.borderColor = '';
      }, 3000);
      return;
    }

    const template = settings.aiPromptTemplate || 'Customize my resume for this job:\n\n[JOB_DESCRIPTION]';
    const prompt = template.replace('[JOB_DESCRIPTION]', jdText);
    const aiUrl = settings.preferredAI === 'gemini' ? 'https://gemini.google.com/app' : 'https://chatgpt.com/';

    await chrome.runtime.sendMessage({ type: 'OPEN_AI_CHAT', aiUrl, prompt });

    btn.title = '✓ Opened!';
    btn.style.color = 'var(--success)';
    btn.style.borderColor = 'var(--success)';
    setTimeout(() => {
      btn.disabled = false;
      btn.title = originalTitle;
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 2000);
    window.close(); // close popup
  } catch (e) {
    console.error('openAiChat error', e);
    btn.disabled = false;
    btn.title = 'Error opening AI chat';
    btn.style.color = '';
    btn.style.borderColor = '';
  }
}

function updateRejectedBadgeCount() {
  const badge = document.getElementById('rejectedCountBadge');
  if (!badge) return;
  const count = allApps.filter((a) => a.status === 'Rejected').length;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

async function initAtsMatch(DB) {
  const panel = document.getElementById('atsMatchPanel');
  if (!panel) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;

  // Only run on http/https pages
  if (!tab.url.startsWith('http')) return;

  const resume = await DB.getResume();
  const skills = (resume && Array.isArray(resume.skills)) ? resume.skills : [];

  // Script to extract the JD from page
  let jdText = '';
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Shared JD extraction (equivalent to content script/popup helper)
        const JD_KEYWORDS = [
          'responsibilities','qualifications','requirements','what you\'ll do',
          'what you will do','who you are','about the role','about this role',
          'minimum qualifications','preferred qualifications','years of experience',
          'you will','we are looking','the ideal candidate','skills required',
          'key skills','job description','position summary','essential functions',
          'education required','compensation','salary','benefits','what we offer',
        ];
        const NOISE_PHRASES = [
          'cookie','accept all','reject all','privacy policy','terms of use',
          'sign in','log in','create account','language','modify cookie',
          'functional cookies','optional cookies','gdpr','data protection',
        ];
        function jdScore(text) {
          const lower = text.toLowerCase();
          let score = 0;
          for (const kw of JD_KEYWORDS) { if (lower.includes(kw)) score += 15; }
          score += Math.min(text.length / 80, 60);
          let noiseHits = 0;
          for (const ph of NOISE_PHRASES) { if (lower.includes(ph)) noiseHits++; }
          score -= noiseHits * 25;
          const lines = text.split('\n').filter(l => l.trim().length > 0);
          const avgLineLen = text.length / Math.max(lines.length, 1);
          if (avgLineLen < 20) score -= 40;
          return score;
        }
        const EXPLICIT = [
          '[data-automation-id*="jobPostingDescription"]',
          '[data-automation-id*="job-description"]',
          '.jobs-description__content', '.jobs-description-content__text',
          '#jobDescriptionText', '.jobsearch-JobComponent-description',
          '#job-details', '.jobDescriptionContent', '[class*="jobDescriptionContent"]',
          '[class*="job-description-body"]', '.xt-jd', '.xtJD',
          '[data-automation="job-description"]',
          '#content', '.job__description', '.posting-description', '.job-sections',
          '.job-description', '#job-description',
          '[class*="job-description"]', '[class*="jobDescription"]',
          '[id*="job-description"]', '[id*="jobDescription"]', 'article',
        ];
        for (const sel of EXPLICIT) {
          try {
            const el = document.querySelector(sel);
            if (!el) continue;
            const text = el.innerText.trim();
            if (text.length > 300 && jdScore(text) > 0) return text.slice(0, 9000);
          } catch {}
        }
        let bestEl = null, bestScore = -Infinity;
        for (const el of document.querySelectorAll('div, section, article, main')) {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          if (el.closest('nav, header, footer, [role="navigation"]')) continue;
          const text = el.innerText.trim();
          if (text.length < 300) continue;
          const score = jdScore(text);
          if (score > bestScore) { bestScore = score; bestEl = el; }
        }
        if (bestEl && bestScore > 10) return bestEl.innerText.trim().slice(0, 9000);
        return '';
      }
    });
    jdText = results?.[0]?.result || '';
  } catch (e) {
    return;
  }

  if (!jdText || jdText.length < 150) return;

  // We are on a job page with a valid job description! Show the panel.
  panel.style.display = 'block';

  const trigger = document.getElementById('atsMatchTrigger');
  const details = document.getElementById('atsMatchDetails');
  const scoreBadge = document.getElementById('atsScoreValue');
  const statsText = document.getElementById('atsStatsText');
  const matchedChips = document.getElementById('atsMatchedChips');
  const missingChips = document.getElementById('atsMissingChips');
  const optimizeBtn = document.getElementById('atsOptimizeBtn');

  // Trigger toggle
  trigger.addEventListener('click', () => {
    const isHidden = details.style.display === 'none';
    details.style.display = isHidden ? 'flex' : 'none';
    trigger.style.background = isHidden ? 'rgba(56,189,248,0.06)' : '';
  });

  if (skills.length === 0) {
    scoreBadge.textContent = 'Setup Required';
    scoreBadge.style.cssText = 'color: var(--warning); background: rgba(245,158,11,0.1); border-color: rgba(245,158,11,0.3); font-size: 10px; cursor: pointer;';
    statsText.textContent = 'Please upload your resume in the dashboard first.';
    matchedChips.innerHTML = '<span class="ats-empty">No resume skills found.</span>';
    missingChips.innerHTML = '<span class="ats-empty">Upload resume to detect missing keywords.</span>';
    
    scoreBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    });
    optimizeBtn.disabled = true;
    optimizeBtn.style.opacity = '0.5';
    optimizeBtn.textContent = 'Upload Resume to Optimize';
    return;
  }

  const SH = window.JobTrackrShared;
  if (!SH || !SH.skillGap) return;

  const { matched, missing } = SH.skillGap(skills, jdText);
  const total = matched.length + missing.length;
  const pct = total > 0 ? Math.round((matched.length / total) * 100) : 0;

  // Set score text
  scoreBadge.textContent = `${pct}% Match`;

  // Set badge colors based on percentage
  if (pct >= 70) {
    scoreBadge.style.cssText = 'color: #34d399; background: rgba(52,211,153,0.08); border-color: rgba(52,211,153,0.2);';
  } else if (pct >= 40) {
    scoreBadge.style.cssText = 'color: #f59e0b; background: rgba(245,158,11,0.08); border-color: rgba(245,158,11,0.2);';
  } else {
    scoreBadge.style.cssText = 'color: #f87171; background: rgba(248,113,113,0.08); border-color: rgba(248,113,113,0.2);';
  }

  // Populate chips
  statsText.textContent = `${matched.length} matched | ${missing.length} missing`;

  matchedChips.innerHTML = matched.length 
    ? matched.map(s => `<span class="ats-chip matched">${escapeHtml(s)}</span>`).join('')
    : '<span class="ats-empty">None of your skills matched exactly.</span>';

  missingChips.innerHTML = missing.length
    ? missing.map(s => `<span class="ats-chip missing">${escapeHtml(s)}</span>`).join('')
    : '<span class="ats-empty">No notable missing keywords detected! 🎉</span>';

  // Optimize action button
  optimizeBtn.addEventListener('click', async () => {
    optimizeBtn.disabled = true;
    optimizeBtn.textContent = 'Preparing Prompts…';

    const settings = await DB.getSettings();
    // Build a targeted prompt highlighting missing keywords
    let customPrompt = `Please help me optimize my resume for the job description below.

I want to specifically target the following skills that are missing or weak in my profile:
${missing.length > 0 ? missing.map(m => `- ${m}`).join('\n') : 'Highlight and align my existing skills.'}

Here is the Job Description:
[JOB_DESCRIPTION]`;

    if (settings.aiPromptTemplate) {
      customPrompt = `Here are some missing/critical skills I need to highlight: ${missing.join(', ')}\n\n` + settings.aiPromptTemplate;
    }

    const prompt = customPrompt.replace('[JOB_DESCRIPTION]', jdText);
    const aiUrl = settings.preferredAI === 'gemini' ? 'https://gemini.google.com/app' : 'https://chatgpt.com/';

    await chrome.runtime.sendMessage({ type: 'OPEN_AI_CHAT', aiUrl, prompt });
    optimizeBtn.textContent = '✓ Opened!';
    setTimeout(() => { window.close(); }, 1000);
  });
}

// Bootstrap — script is at end of <body>, DOM should already be parsed
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init().catch(console.error));
} else {
  init().catch(console.error);
}
