// JobTrackr Content Script — Phase 1 & Phase 2 job detection
(function () {
  'use strict';

  if (window.__jobtrackrDetectorLoaded) return;
  window.__jobtrackrDetectorLoaded = true;

  // `url` is mutable: LinkedIn/Workday are SPAs that change the URL via pushState
  // without reloading the content script, so we refresh it before each detection.
  let url        = window.location.href;
  const hostname = window.location.hostname.toLowerCase();

  // ── Platform config ────────────────────────────────────────────────────────
  const PLATFORMS = {
    linkedin: {
      name: 'linkedin',
      // Only individual job pages — NOT the search/list page (/jobs/ alone)
      urlMatch: () => hostname.includes('linkedin.com') && (
        url.includes('/jobs/view/') ||
        url.includes('/jobs/collections/') ||
        (url.includes('/jobs/') && /[?&]currentJobId=\d/.test(url))
      ),
      phase2Text: ['application submitted', 'your application was sent', 'applied to'],
      // LinkedIn frequently renames classes — try many variants + generic fallbacks
      jdSelectors: [
        '.jobs-description__content',
        '.jobs-description-content__text',
        '[class*="jobs-description"]',
        '.job-view-layout .jobs-box__html-content',
        '#job-details',
        '[class*="description__text"]',
      ],
      titleSelectors: [
        '.job-details-jobs-unified-top-card__job-title h1',
        '.job-details-jobs-unified-top-card__job-title',
        '.jobs-unified-top-card__job-title',
        'h1[class*="job-title"]',
        'h1',
      ],
      companySelectors: [
        '.job-details-jobs-unified-top-card__company-name a',
        '.job-details-jobs-unified-top-card__company-name',
        '.jobs-unified-top-card__company-name a',
        '.jobs-unified-top-card__company-name',
        '[class*="company-name"] a',
        '[class*="company-name"]',
        'a[data-tracking-control-name*="company"]',
        '[class*="topcard__org-name-link"]',
        '[class*="topcard"] [class*="org"]',
      ],
      locationSelectors: [
        '.job-details-jobs-unified-top-card__bullet',
        '.jobs-unified-top-card__bullet',
        '[class*="topcard__flavor--bullet"]',
      ],
    },

    indeed: {
      name: 'indeed',
      urlMatch: () => hostname.includes('indeed.com'),
      phase2Text: ['your application has been submitted', 'application submitted', 'thank you for applying'],
      jdSelectors: ['#jobDescriptionText', '.jobsearch-jobDescriptionText', '[data-testid="jobsearch-JobComponent-description"]'],
      titleSelectors: ['[data-testid="jobsearch-JobInfoHeader-title"]', '.jobsearch-JobInfoHeader-title', 'h1'],
      companySelectors: ['[data-testid="inlineHeader-companyName"]', '.jobsearch-InlineCompanyRating-companyName', '[class*="CompanyName"]'],
      locationSelectors: ['[data-testid="job-location"]', '.jobsearch-JobInfoHeader-subtitle'],
    },

    greenhouse: {
      name: 'greenhouse',
      urlMatch: () => hostname.includes('greenhouse.io') || hostname.includes('boards.greenhouse.io'),
      phase2Text: ['application submitted', 'thank you for applying', 'your application has been received'],
      jdSelectors: ['#content', '.job__description', '[class*="job-description"]'],
      titleSelectors: ['.app-title', 'h1'],
      companySelectors: ['.company-name', '.header--title', 'h2'],
      locationSelectors: ['.location', '[class*="location"]'],
    },

    lever: {
      name: 'lever',
      urlMatch: () => hostname.includes('lever.co'),
      phase2Text: ['your application has been received', 'application submitted', 'thank you for applying'],
      jdSelectors: ['.posting-description', '.content', '.section-wrapper'],
      titleSelectors: ['.posting-headline h2', 'h2', 'h1'],
      companySelectors: ['.main-header-text', '[class*="company"]'],
      locationSelectors: ['.posting-categories .sort-by-location'],
    },

    workday: {
      name: 'workday',
      urlMatch: () => hostname.includes('myworkdayjobs.com') || hostname.includes('workday.com'),
      phase2Text: ['you have successfully submitted', 'thank you for applying', 'application submitted'],
      jdSelectors: ['[data-automation-id="jobPostingDescription"]', '[data-automation-id*="description"]'],
      titleSelectors: ['[data-automation-id="jobPostingHeader"]', 'h2', 'h1'],
      companySelectors: ['[data-automation-id="company"]', '[data-automation-id*="company"]'],
      locationSelectors: ['[data-automation-id="locations"]'],
    },

    glassdoor: {
      name: 'glassdoor',
      urlMatch: () => hostname.includes('glassdoor.com'),
      phase2Text: ['application submitted', 'your application has been sent'],
      jdSelectors: ['.jobDescriptionContent', '[data-test="jobDescriptionContent"]', '[class*="jobDescription"]'],
      titleSelectors: ['[data-test="job-title"]', 'h1'],
      companySelectors: ['[data-test="employer-name"]', '.employer-name', '[class*="employer"]'],
      locationSelectors: ['[data-test="location"]'],
    },

    ziprecruiter: {
      name: 'ziprecruiter',
      urlMatch: () => hostname.includes('ziprecruiter.com'),
      phase2Text: ['application sent', 'you have applied', 'application submitted'],
      jdSelectors: ['.jobDescriptionSection', '[data-testid="job-description"]'],
      titleSelectors: ['.job_title', 'h1'],
      companySelectors: ['.hiring_company_text', '.t_company_name'],
      locationSelectors: ['.location_text'],
    },

    dice: {
      name: 'dice',
      urlMatch: () => hostname.includes('dice.com'),
      phase2Text: ['application submitted', 'successfully applied'],
      jdSelectors: ['[data-cy="jobDescription"]', '.job-description'],
      titleSelectors: ['[data-cy="jobTitle"]', 'h1'],
      companySelectors: ['[data-cy="companyNameLink"]', '.company-name'],
      locationSelectors: ['[data-cy="location"]'],
    },

    wellfound: {
      name: 'wellfound',
      urlMatch: () => hostname.includes('wellfound.com') || hostname.includes('angel.co'),
      phase2Text: ['application submitted', 'thank you for applying'],
      jdSelectors: ['.job-description', '[class*="jobDescription"]'],
      titleSelectors: ['h1', '[class*="jobTitle"]'],
      companySelectors: ['[class*="companyName"]', 'h2'],
      locationSelectors: ['[class*="location"]'],
    },

    smartrecruiters: {
      name: 'smartrecruiters',
      urlMatch: () => hostname.includes('smartrecruiters.com'),
      phase2Text: ['application submitted', 'thank you for applying'],
      jdSelectors: ['.job-sections', '[class*="job-section"]', '.details-section'],
      titleSelectors: ['.job-title', 'h1'],
      companySelectors: ['.company-name', '[class*="company"]'],
      locationSelectors: ['.job-detail [class*="location"]'],
    },

    icims: {
      name: 'icims',
      urlMatch: () => hostname.includes('icims.com'),
      phase2Text: ['thank you for applying', 'application submitted'],
      jdSelectors: ['[id*="description"]', '.job-description', '[class*="field-description"]'],
      titleSelectors: ['[id*="jobtitle"]', 'h1', 'h2'],
      companySelectors: ['[class*="company"]', '[id*="company"]'],
      locationSelectors: ['[class*="location"]'],
    },
  };

  // Strong, unambiguous post-submission phrases only.
  // Removed weak phrases ("thank you for your interest", "we'll be in touch")
  // that commonly appear in job descriptions/rejections BEFORE applying and
  // caused false Pending→Applied promotions.
  const GENERIC_CONFIRMATION_PHRASES = [
    'application submitted', 'your application has been submitted',
    'your application has been received', 'application has been sent',
    'successfully submitted your application', 'thank you for submitting your application',
    'your application was sent', 'we have received your application',
  ];

  // ── JD quality scoring — shared module (single source of truth) ───────────
  const SHARED = window.JobTrackrShared;
  const JD_KEYWORDS = SHARED.JD_KEYWORDS;
  const jdScore = SHARED.jdScore;
  const isLoadingContent = SHARED.isLoadingContent;

  // ── Data extraction ────────────────────────────────────────────────────────
  function getText(selectors) {
    if (!selectors) return '';
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const t = el.innerText.trim();
          if (t) return t;
        }
      } catch {}
    }
    return '';
  }

  function getMetaContent(names) {
    for (const name of names) {
      const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
      if (el && el.content) return el.content.trim();
    }
    return '';
  }

  function extractStructuredData(key) {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item[key]) return item[key];
          if (item['@graph']) {
            for (const node of item['@graph']) {
              if (node[key]) return node[key];
            }
          }
        }
      } catch {}
    }
    return '';
  }

  // Smart JD extraction with scoring
  function extractJD(cfg) {
    // 1. Try platform-specific selectors first
    const selectors = cfg ? cfg.jdSelectors : [];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.innerText.trim();
          if (text.length > 200 && jdScore(text) > 0) return text.slice(0, 10000);
        }
      } catch {}
    }

    // 2. Try structured data (most reliable across all sites)
    const ldJD = extractStructuredData('description');
    if (ldJD && typeof ldJD === 'string' && ldJD.length > 200) {
      const clean = ldJD.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (jdScore(clean) > 0) return clean.slice(0, 10000);
    }

    // 3. Score all block elements and pick the winner
    let bestEl = null, bestScore = -Infinity;
    const blocks = document.querySelectorAll('div, section, article, main, [class*="job"], [class*="description"]');
    for (const el of blocks) {
      try {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (el.closest('nav, header, footer, [role="navigation"], [role="banner"]')) continue;
        const text = el.innerText.trim();
        if (text.length < 200) continue;
        const score = jdScore(text);
        if (score > bestScore) { bestScore = score; bestEl = el; }
      } catch {}
    }

    if (bestEl && bestScore > 10) return bestEl.innerText.trim().slice(0, 10000);
    return '';
  }

  // Capitalize a company token: short names (≤4 chars) → ALL CAPS, longer → Title Case
  function formatCompanyName(raw) {
    if (!raw) return '';
    const s = raw.trim();
    // Already mixed-case (e.g. "Goldman Sachs", "JPMorgan") — keep as-is
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) return s;
    // Short acronym: ey, pnc, ibm, ups → EY, PNC, IBM, UPS
    if (s.replace(/[^a-z0-9]/gi, '').length <= 4) return s.toUpperCase();
    // Long all-lowercase: title-case each word
    return s.replace(/\b\w/g, c => c.toUpperCase());
  }

  // Smart company extraction with multiple fallback layers
  function extractCompany(cfg) {
    // 1. Platform-specific DOM selectors
    const fromDOM = cfg ? getText(cfg.companySelectors) : '';
    if (fromDOM && fromDOM.length > 1 && fromDOM.toLowerCase() !== 'unknown') return formatCompanyName(fromDOM);

    // 2. JSON-LD structured data (JobPosting schema — most reliable)
    const ld = extractStructuredData('hiringOrganization');
    if (ld) {
      const name = typeof ld === 'string' ? ld : (ld.name || '');
      if (name && name.length > 1) return formatCompanyName(name.trim());
    }

    // 3. Page title: "Job Title at Company | Site"
    const pageTitle = document.title;
    const atMatch = pageTitle.match(/ at ([^|()\[\]–\-]{2,50})(?:\s*[\|–(]|$)/);
    if (atMatch) {
      const c = atMatch[1].trim();
      const SKIP = ['linkedin', 'indeed', 'glassdoor', 'ziprecruiter', 'dice', 'monster', 'jobvite'];
      if (!SKIP.some(p => c.toLowerCase().includes(p))) return formatCompanyName(c);
    }

    // 4. og:title — "Company is hiring for..."  or "Job at Company"
    const ogTitle = getMetaContent(['og:title']);
    const ogAtMatch = ogTitle.match(/ at ([^|()\[\]]{2,50})(?:\s*[\|(]|$)/);
    if (ogAtMatch) return formatCompanyName(ogAtMatch[1].trim());

    // 5. og:site_name — works for branded career sites
    const siteName = getMetaContent(['og:site_name']);
    const PLATFORM_NAMES = ['linkedin', 'indeed', 'glassdoor', 'ziprecruiter', 'dice', 'monster',
                             'workday', 'greenhouse', 'lever', 'icims', 'taleo', 'smartrecruiters'];
    if (siteName && !PLATFORM_NAMES.some(p => siteName.toLowerCase().includes(p))) {
      return formatCompanyName(siteName);
    }

    // 6. Workday: pnc.wd5.myworkdayjobs.com → "PNC"
    //    Pull the first subdomain segment (before the platform sub-domain)
    if (hostname.includes('myworkdayjobs.com') || hostname.includes('workday.com')) {
      const wdMatch = hostname.match(/^([a-z0-9\-]+)\./);
      if (wdMatch) return formatCompanyName(wdMatch[1]);
    }

    // 7. Careers/jobs subdomain: careers.ey.com → "EY", jobs.stripe.com → "Stripe"
    const subMatch = hostname.match(/^(?:careers|jobs|work|talent|hiring)\.([\w\-]+)\./);
    if (subMatch) return formatCompanyName(subMatch[1]);

    // 8. Second-level domain as last resort: ey.com → "EY"
    const domMatch = hostname.match(/([a-z0-9\-]+)\.[a-z]{2,}$/);
    if (domMatch) {
      const d = domMatch[1];
      const THIRD_PARTY = ['myworkdayjobs', 'greenhouse', 'lever', 'taleo', 'icims',
                           'successfactors', 'smartrecruiters', 'jobvite', 'brassring',
                           'wd5', 'wd1', 'wd3', 'wd10'];
      if (!THIRD_PARTY.includes(d)) return formatCompanyName(d);
    }

    return '';
  }

  // Smart title extraction
  function extractTitle(cfg) {
    const fromDOM = cfg ? getText(cfg.titleSelectors) : '';
    if (fromDOM) return cleanTitle(fromDOM);

    // JSON-LD
    const ldTitle = extractStructuredData('title');
    if (ldTitle) return cleanTitle(ldTitle);

    // og:title — often has the job title
    const ogTitle = getMetaContent(['og:title']);
    if (ogTitle) {
      const clean = ogTitle.split(/\s+(at|@|-|–|\|)\s+/)[0].trim();
      if (clean) return cleanTitle(clean);
    }

    // Page title first segment
    return cleanTitle(document.title.split(/\s*([-–|])\s*/)[0]);
  }

  function cleanTitle(title) {
    // Remove trailing " - Apply" or " | LinkedIn" etc.
    return title.replace(/\s*[|–-]\s*(apply|linkedin|indeed|glassdoor|job.*)?$/i, '').trim();
  }

  // ── Full job info extraction ───────────────────────────────────────────────
  function extractJobInfo(platformMatch) {
    const cfg = platformMatch ? platformMatch.cfg : null;

    const jobTitle = extractTitle(cfg);
    const company  = extractCompany(cfg);
    const location = (cfg ? getText(cfg.locationSelectors) : '') || extractJDLocation();
    const jobDescription = extractJD(cfg);
    const platform = cfg ? cfg.name : getPlatformFromHostname();

    return { jobTitle, company, location, jobDescription, platform };
  }

  // JSON-LD jobLocation may be an object OR an array of locations.
  function extractJDLocation() {
    const loc = extractStructuredData('jobLocation');
    if (!loc) return '';
    const first = Array.isArray(loc) ? loc[0] : loc;
    const addr = first && first.address;
    if (!addr) return '';
    return [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', ');
  }

  function getPlatformFromHostname() {
    if (hostname.includes('linkedin'))      return 'linkedin';
    if (hostname.includes('indeed'))        return 'indeed';
    if (hostname.includes('greenhouse'))    return 'greenhouse';
    if (hostname.includes('lever'))         return 'lever';
    if (hostname.includes('myworkdayjobs') || hostname.includes('workday')) return 'workday';
    if (hostname.includes('glassdoor'))     return 'glassdoor';
    if (hostname.includes('ziprecruiter')) return 'ziprecruiter';
    if (hostname.includes('dice'))          return 'dice';
    if (hostname.includes('wellfound') || hostname.includes('angel.co')) return 'wellfound';
    if (hostname.includes('smartrecruiters')) return 'smartrecruiters';
    if (hostname.includes('icims'))         return 'icims';
    return 'other';
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  function showToast(message, type = 'info', duration = 6000) {
    const existing = document.getElementById('jobtrackr-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'jobtrackr-toast';
    toast.style.cssText = `
      position:fixed;bottom:24px;right:24px;z-index:2147483647;
      background:#1e293b;color:#f1f5f9;border:1px solid #334155;
      border-radius:12px;padding:14px 18px;
      font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;
      font-size:13px;line-height:1.5;max-width:340px;
      box-shadow:0 8px 32px rgba(0,0,0,0.4);cursor:pointer;
      transition:opacity 0.3s;opacity:0;
      border-left:3px solid ${type === 'success' ? '#34d399' : type === 'warning' ? '#f59e0b' : '#38bdf8'};
    `;
    toast.innerHTML = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    toast.addEventListener('click', () => toast.remove());
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function pageContainsText(phrases) {
    const bodyText = document.body.innerText.toLowerCase();
    return phrases.some(p => bodyText.includes(p.toLowerCase()));
  }

  // ── Detection: only fires when an application is actually SUBMITTED ─────────
  // (No more "Pending" tracking on page-view/scroll — that created dummy data.)
  let submissionFired = false;

  function checkSubmission(platformMatch) {
    if (submissionFired) return;
    url = window.location.href; // refresh for SPA navigation

    const cfg = platformMatch ? platformMatch.cfg : null;
    const confirmed = (cfg && cfg.phase2Text && pageContainsText(cfg.phase2Text)) ||
                      pageContainsText(GENERIC_CONFIRMATION_PHRASES);

    if (!confirmed) return;

    submissionFired = true;
    const info = extractJobInfo(platformMatch);

    chrome.runtime.sendMessage({
      type: 'APPLICATION_SUBMITTED',
      url,
      jobTitle:       info.jobTitle,
      company:        info.company,
      platform:       info.platform,
      location:       info.location,
      jobDescription: info.jobDescription,
    }, (response) => {
      if (chrome.runtime.lastError || !response) return;

      if (response.created) {
        showToast(
          `<strong>✅ Application tracked!</strong><br>${escapeHtml(info.jobTitle)} at ${escapeHtml(info.company)}<br><span style="color:#34d399;font-size:11px">Status: Applied</span>`,
          'success'
        );
      } else if (response.alreadyApplied) {
        showToast(
          `<strong>Already tracked</strong><br>You already have an application for <em>${escapeHtml(info.jobTitle)}</em> at <em>${escapeHtml(info.company)}</em>.`,
          'info'
        );
      }
    });
  }

  // ── Platform detection ─────────────────────────────────────────────────────
  function detectPlatform() {
    url = window.location.href; // refresh for SPA navigation
    for (const [key, cfg] of Object.entries(PLATFORMS)) {
      if (cfg.urlMatch()) return { key, cfg };
    }
    return null;
  }

  function isJobRelatedPage() {
    const path = window.location.pathname.toLowerCase();
    // Require a sub-path after the keyword — so /jobs/ alone (list pages) doesn't match,
    // but /jobs/view/123 or /careers/software-engineer does.
    if (/\/(jobs?|careers?|positions?|openings?|vacancies?|roles?|postings?)\/[^/]/.test(path)) return true;
    // Also catch paths like /job-123 or /job_detail?id=
    if (/\/(job|career|position|opening|vacancy|role|posting)[_\-]/.test(path)) return true;
    // Content heuristic — need ≥3 JD phrases to avoid false positives on list/search pages
    const bodyText = document.body.innerText.toLowerCase().slice(0, 3000);
    const hits = JD_KEYWORDS.filter(kw => bodyText.includes(kw)).length;
    return hits >= 3;
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    let settings;
    try {
      settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    } catch {
      settings = { autoDetect: true };
    }
    if (!settings || !settings.autoDetect) return;

    const platformMatch  = detectPlatform();
    const isKnownPlatform = !!platformMatch;
    const isJobPage      = isKnownPlatform || isJobRelatedPage();

    if (!isJobPage) return;

    // Watch for an application-submission confirmation. This is the ONLY trigger
    // now — nothing is tracked just from viewing/scrolling a job listing.
    // Debounced: serializing document.body.innerText on every mutation is
    // expensive on heavy SPAs (LinkedIn/Workday). Coalesce bursts into one check.
    let submitTimer = null;
    const observer = new MutationObserver(() => {
      if (submissionFired) { observer.disconnect(); return; }
      if (submitTimer) return;
      submitTimer = setTimeout(() => {
        submitTimer = null;
        checkSubmission(detectPlatform());
      }, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 30 * 60 * 1000);

    // Also check once shortly after load, in case the page already shows a
    // confirmation (e.g. landing directly on a "thank you" page).
    setTimeout(() => checkSubmission(detectPlatform()), 1500);

    // Reset the submission flag on SPA navigation so a later submit is caught.
    let lastUrl = url;
    new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        submissionFired = false;
      }
    }).observe(document.body, { childList: true, subtree: false });
  }

  init().catch(console.error);
})();
