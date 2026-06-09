// JobTrackr Content Script — Resume Auto-Fill
(function () {
  'use strict';

  if (window.__jobtrackrAutofillLoaded) return;
  window.__jobtrackrAutofillLoaded = true;

  // ── Field maps ─────────────────────────────────────────────────────────────

  const TEXT_FIELD_MAP = [
    { resumeKey: 'firstName',    keywords: ['first name', 'given name', 'fname', 'firstname', 'legal first'] },
    { resumeKey: 'lastName',     keywords: ['last name', 'surname', 'family name', 'lname', 'lastname', 'legal last'] },
    { resumeKey: '__fullName',   keywords: ['full name', 'your name', 'applicant name', 'legal name'] },
    { resumeKey: 'email',        keywords: ['email', 'e-mail', 'email address'] },
    { resumeKey: 'phone',        keywords: ['phone', 'mobile', 'telephone', 'contact number', 'cell', 'phone number'] },
    { resumeKey: 'linkedinUrl',  keywords: ['linkedin'] },
    { resumeKey: 'githubUrl',    keywords: ['github'] },
    { resumeKey: 'portfolioUrl', keywords: ['website', 'portfolio', 'personal site'] },
    { resumeKey: 'address.city',  keywords: ['city', 'town', 'municipality'] },
    { resumeKey: 'address.state', keywords: ['state', 'province', 'region'] },
    { resumeKey: 'address.zip',   keywords: ['zip', 'postal', 'zip code', 'postal code'] },
    { resumeKey: 'currentTitle',  keywords: ['current title', 'current role', 'job title', 'position'] },
    { resumeKey: 'summary',       keywords: ['cover letter', 'summary', 'about you', 'about yourself', 'tell us about', 'introduction', 'additional information'] },
  ];

  const EEO_FIELD_MAP = [
    {
      settingKey: 'gender',
      keywords: ['gender', 'sex', 'pronouns'],
    },
    {
      settingKey: 'veteranStatus',
      keywords: ['veteran', 'military', 'armed forces', 'service member', 'protected veteran'],
    },
    {
      settingKey: 'disabilityStatus',
      keywords: ['disability', 'disabled', 'handicap', 'impairment', 'section 503'],
    },
    {
      settingKey: 'hispanicLatino',
      keywords: ['hispanic', 'latino', 'latina', 'latinx', 'spanish origin'],
    },
    {
      settingKey: 'ethnicity',
      keywords: ['race', 'ethnicity', 'ethnic', 'racial background'],
    },
    {
      settingKey: 'workAuthorization',
      keywords: ['work authorization', 'authorized to work', 'legally authorized', 'work status', 'visa status', 'employment eligibility', 'right to work', 'work in the united states'],
    },
    {
      settingKey: 'requireSponsorship',
      keywords: ['sponsorship', 'visa sponsorship', 'require sponsorship', 'need sponsorship', 'sponsor', 'require visa'],
    },
    {
      settingKey: 'citizenshipCountry',
      keywords: ['citizenship', 'country of citizenship', 'nationality', 'citizen of'],
    },
  ];

  // ── Platform detection ─────────────────────────────────────────────────────

  const PLATFORM_PATTERNS = [
    { name: 'workday',     test: h => h.includes('myworkdayjobs.com') || h.includes('workday.com') },
    { name: 'greenhouse',  test: h => h.includes('greenhouse.io') },
    { name: 'lever',       test: h => h.includes('lever.co') },
    { name: 'linkedin',    test: h => h.includes('linkedin.com') },
    { name: 'indeed',      test: h => h.includes('indeed.com') },
    { name: 'smartrecruiters', test: h => h.includes('smartrecruiters.com') },
    { name: 'icims',       test: h => h.includes('icims.com') },
    { name: 'taleo',       test: h => h.includes('taleo.net') },
    { name: 'jobvite',     test: h => h.includes('jobvite.com') },
    { name: 'brassring',   test: h => h.includes('brassring.com') },
  ];

  function detectPlatform() {
    const h = window.location.hostname;
    const found = PLATFORM_PATTERNS.find(p => p.test(h));
    return found ? found.name : 'generic';
  }

  function isApplicationPage(platform) {
    const url = window.location.href.toLowerCase();

    if (platform === 'workday') {
      // Workday apply pages contain /apply in path, or show automation-id inputs
      return url.includes('/apply') ||
             document.querySelector('[data-automation-id]') !== null ||
             document.querySelector('input[aria-required]') !== null;
    }
    if (platform === 'greenhouse') return true;
    if (platform === 'lever')      return url.includes('/apply') || url.includes('application');
    if (platform === 'linkedin')   return url.includes('apply') || url.includes('easy-apply');
    if (platform === 'smartrecruiters') return url.includes('/apply') || url.includes('application');
    if (platform === 'icims' || platform === 'taleo' || platform === 'brassring') return true;

    // Generic: need visible inputs + submit button
    const inputs = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
    );
    if (inputs.length < 3) return false;
    return !!document.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
  }

  // ── Label extraction ───────────────────────────────────────────────────────

  function getFieldLabel(el) {
    const texts = [];

    // 1. Explicit label[for]
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) texts.push(lbl.textContent.toLowerCase().trim());
    }

    // 2. aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach(id => {
        const ref = document.getElementById(id);
        if (ref) texts.push(ref.textContent.toLowerCase().trim());
      });
    }

    // 3. aria-label, placeholder, name, id, title
    for (const attr of ['aria-label', 'placeholder', 'name', 'id', 'title', 'data-label']) {
      const v = el.getAttribute(attr);
      if (v) texts.push(v.toLowerCase().replace(/[_\-]/g, ' ').trim());
    }

    // 4. Workday: data-automation-id on closest ancestor wrapper
    const autoEl = el.closest('[data-automation-id]');
    if (autoEl) {
      texts.push(autoEl.getAttribute('data-automation-id').replace(/[_\-]/g, ' ').toLowerCase());
    }

    // 5. Wrapping label element
    const parentLabel = el.closest('label');
    if (parentLabel) texts.push(parentLabel.textContent.toLowerCase().trim());

    // 6. Nearby sibling / parent text (short labels above inputs)
    const parent = el.parentElement;
    if (parent) {
      // Look for a label-like element in the same container
      const siblingLabel = parent.querySelector('label, .label, [class*="label"], legend');
      if (siblingLabel) texts.push(siblingLabel.textContent.toLowerCase().trim());
      else {
        const parentText = parent.textContent.toLowerCase().replace(el.value || '', '').trim();
        if (parentText.length < 100) texts.push(parentText);
      }
    }

    return texts.join(' ');
  }

  // ── Matching ───────────────────────────────────────────────────────────────

  function matchTextField(labelText) {
    for (const m of TEXT_FIELD_MAP) {
      if (m.keywords.some(kw => labelText.includes(kw))) return m.resumeKey;
    }
    return null;
  }

  function matchEeoField(labelText) {
    for (const m of EEO_FIELD_MAP) {
      if (m.keywords.some(kw => labelText.includes(kw))) return m;
    }
    return null;
  }

  function findBestOption(options, preferenceValue) {
    if (!preferenceValue) return null;
    const pref = preferenceValue.toLowerCase();

    for (const opt of options) {
      if (opt.text.toLowerCase() === pref) return opt;
    }
    for (const opt of options) {
      const t = opt.text.toLowerCase();
      if (t.includes(pref) || pref.includes(t)) return opt;
    }
    const prefWords = pref.split(/\s+/).filter(w => w.length > 2);
    let best = null, bestScore = 0;
    for (const opt of options) {
      const optWords = opt.text.toLowerCase().split(/\s+/);
      const score = prefWords.filter(w => optWords.some(ow => ow.includes(w) || w.includes(ow))).length;
      if (score > bestScore) { bestScore = score; best = opt; }
    }
    return bestScore > 0 ? best : null;
  }

  function getResumeValue(resume, key) {
    if (key === '__fullName') return [resume.firstName, resume.lastName].filter(Boolean).join(' ');
    if (key.includes('.')) {
      return key.split('.').reduce((obj, k) => (obj ? obj[k] : ''), resume) || '';
    }
    return resume[key] || '';
  }

  // ── Fill helpers ───────────────────────────────────────────────────────────

  function highlight(el) {
    const origBorder  = el.style.border;
    const origOutline = el.style.outline;
    el.style.border  = '2px solid #34d399';
    el.style.outline = '2px solid rgba(52,211,153,0.3)';
    el.style.transition = 'border 0.4s, outline 0.4s';
    setTimeout(() => { el.style.border = origBorder; el.style.outline = origOutline; }, 1800);
  }

  function fillInput(input, value) {
    if (!value) return false;

    // Native setter bypasses React/Angular controlled-input guards
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, value);
    else input.value = value;

    // Full event sequence for React (needs InputEvent with inputType)
    input.dispatchEvent(new Event('focus', { bubbles: true }));
    input.dispatchEvent(new InputEvent('input',  { bubbles: true, data: value, inputType: 'insertText' }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur',   { bubbles: true }));

    highlight(input);
    return true;
  }

  function fillSelect(select, preferenceValue) {
    const opt = findBestOption(Array.from(select.options), preferenceValue);
    if (!opt) return false;
    select.value = opt.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    highlight(select);
    return true;
  }

  function fillRadioGroup(container, preferenceValue) {
    const radios = Array.from(container.querySelectorAll('input[type="radio"]'));
    if (!radios.length) return false;
    const options = radios.map((r, i) => {
      const lbl = r.id ? document.querySelector(`label[for="${CSS.escape(r.id)}"]`) : null;
      const text = lbl ? lbl.textContent.trim() : (r.value || '');
      return { text, value: String(i) };
    });
    const best = findBestOption(options, preferenceValue);
    if (!best) return false;
    const radio = radios[parseInt(best.value)];
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    radio.dispatchEvent(new Event('click',  { bubbles: true }));
    return true;
  }

  // ── Workday custom widget fill ─────────────────────────────────────────────
  // Workday uses button-triggered dropdowns, not <select>. This finds the trigger
  // button, clicks it to open the menu, then clicks the best matching option.
  async function fillWorkdayDropdown(triggerEl, preferenceValue) {
    if (!preferenceValue) return false;
    triggerEl.click();
    await new Promise(r => setTimeout(r, 400));

    // Workday menus render in a listbox
    const listbox = document.querySelector('[role="listbox"], [data-automation-id*="menu"]');
    if (!listbox) return false;

    const items = Array.from(listbox.querySelectorAll('[role="option"], li, [data-automation-id*="option"]'));
    const options = items.map((el, i) => ({ text: el.textContent.trim(), value: String(i), el }));
    const best = findBestOption(options, preferenceValue);
    if (!best) {
      // Close menu
      document.body.click();
      return false;
    }
    options[parseInt(best.value)].el.click();
    return true;
  }

  // ── Main autofill ──────────────────────────────────────────────────────────

  async function performAutofill(resume, settings, platform) {
    let filled = 0;

    // ── Text / textarea ──────────────────────────────────────────────────────
    const textInputs = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea'
    ));

    for (const input of textInputs) {
      const label = getFieldLabel(input);
      const key   = matchTextField(label);
      if (!key) continue;
      const value = getResumeValue(resume, key);
      if (value && fillInput(input, value)) filled++;
    }

    // ── Standard <select> EEO ───────────────────────────────────────────────
    for (const select of document.querySelectorAll('select')) {
      const label   = getFieldLabel(select);
      const mapping = matchEeoField(label);
      if (!mapping || !settings) continue;
      const pref = settings[mapping.settingKey];
      if (pref && fillSelect(select, pref)) filled++;
    }

    // ── Radio groups EEO ────────────────────────────────────────────────────
    const radioGroups = {};
    document.querySelectorAll('input[type="radio"]').forEach(r => {
      const name = r.name || r.closest('fieldset')?.id || '';
      if (!radioGroups[name]) radioGroups[name] = [];
      radioGroups[name].push(r);
    });

    for (const radios of Object.values(radioGroups)) {
      const first    = radios[0];
      const fieldset = first.closest('fieldset');
      const legend   = fieldset?.querySelector('legend');
      const label    = legend ? legend.textContent.toLowerCase() : getFieldLabel(first);
      const mapping  = matchEeoField(label);
      if (!mapping || !settings) continue;
      const pref      = settings[mapping.settingKey];
      const container = fieldset || first.closest('div, section') || document.body;
      if (pref && fillRadioGroup(container, pref)) filled++;
    }

    // ── Workday custom dropdowns ─────────────────────────────────────────────
    if (platform === 'workday') {
      // Workday renders button-triggered dropdowns for EEO fields
      const triggers = Array.from(document.querySelectorAll(
        'button[data-automation-id], [role="combobox"], [aria-haspopup="listbox"]'
      ));
      for (const trigger of triggers) {
        const label   = getFieldLabel(trigger);
        const mapping = matchEeoField(label);
        if (!mapping || !settings) continue;
        const pref = settings[mapping.settingKey];
        if (pref && await fillWorkdayDropdown(trigger, pref)) filled++;
      }
    }

    showToast(`✅ Filled ${filled} field${filled !== 1 ? 's' : ''}. Review before submitting.`);
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  function showToast(message, type = 'success') {
    const existing = document.getElementById('jobtrackr-autofill-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'jobtrackr-autofill-toast';
    toast.style.cssText = `
      position:fixed;bottom:80px;right:24px;z-index:2147483646;
      background:#1e293b;color:#f1f5f9;border:1px solid #334155;
      border-radius:12px;padding:12px 16px;
      font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;
      font-size:13px;box-shadow:0 8px 32px rgba(0,0,0,0.4);opacity:0;
      border-left:3px solid ${type === 'success' ? '#34d399' : '#38bdf8'};
      transition:opacity 0.3s;max-width:320px;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 5000);
  }

  // ── Auto-Fill button ───────────────────────────────────────────────────────

  function createAutoFillButton(resume, settings, platform) {
    if (document.getElementById('jobtrackr-autofill-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'jobtrackr-autofill-btn';
    btn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
      </svg>
      <span>Auto-Fill Form</span>
    `;
    btn.style.cssText = `
      position:fixed;bottom:24px;right:24px;z-index:2147483645;
      background:linear-gradient(135deg,#0ea5e9,#38bdf8);color:#fff;
      border:none;border-radius:50px;padding:11px 18px;
      font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;
      font-size:13px;font-weight:600;cursor:pointer;
      box-shadow:0 4px 20px rgba(14,165,233,0.45);
      display:flex;align-items:center;gap:8px;
      transition:transform 0.15s,box-shadow 0.15s;
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-2px)';
      btn.style.boxShadow = '0 8px 28px rgba(14,165,233,0.55)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
      btn.style.boxShadow = '0 4px 20px rgba(14,165,233,0.45)';
    });
    btn.addEventListener('click', () => performAutofill(resume, settings, platform));
    document.body.appendChild(btn);
  }

  // ── Create Custom Resume button ────────────────────────────────────────────

  // JD scoring delegates to the shared module (single source of truth).
  const jdScore = window.JobTrackrShared.jdScore;

  function smartExtractJD() {
    // 1. Try explicit high-confidence selectors first
    const EXPLICIT_SELECTORS = [
      // Workday
      '[data-automation-id*="jobPostingDescription"]',
      '[data-automation-id*="job-description"]',
      // LinkedIn
      '.jobs-description__content',
      '.jobs-description-content__text',
      // Indeed
      '#jobDescriptionText',
      '.jobsearch-JobComponent-description',
      // SuccessFactors / SAP (EY, many large corps)
      '#job-details',
      '.jobDescriptionContent',
      '[class*="jobDescriptionContent"]',
      '[class*="job-description-body"]',
      '.xt-jd', '.xtJD',
      '[data-automation="job-description"]',
      // Greenhouse
      '#content', '.job__description',
      // Lever
      '.posting-description',
      // SmartRecruiters
      '.job-sections',
      // Generic
      '.job-description', '#job-description',
      '[class*="job-description"]:not(nav):not(header)',
      '[class*="jobDescription"]:not(nav):not(header)',
      '[id*="job-description"]', '[id*="jobDescription"]',
      'article',
    ];

    for (const sel of EXPLICIT_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const text = el.innerText.trim();
        const score = jdScore(text);
        if (text.length > 300 && score > 0) {
          return text.slice(0, 9000);
        }
      } catch { /* invalid selector */ }
    }

    // 2. Score ALL reasonably sized block elements and pick the best
    const candidates = Array.from(document.querySelectorAll('div, section, article, main'))
      .filter(el => {
        // Skip invisible elements
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        // Skip nav/header/footer
        if (el.closest('nav, header, footer, [role="navigation"], [role="banner"]')) return false;
        const text = el.innerText.trim();
        return text.length > 300;
      });

    let bestEl = null, bestScore = -Infinity;
    for (const el of candidates) {
      // Avoid scoring a parent that just wraps a better child we already scored
      const score = jdScore(el.innerText.trim());
      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    if (bestEl && bestScore > 10) {
      return bestEl.innerText.trim().slice(0, 9000);
    }

    return '';
  }

  function extractJobDescription() {
    return smartExtractJD();
  }

  function createCustomResumeButton(settings) {
    if (document.getElementById('jobtrackr-ai-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'jobtrackr-ai-btn';

    // Tooltip label shown on hover via title attribute
    const aiLabel = settings.preferredAI === 'gemini' ? 'Gemini' : 'ChatGPT';
    btn.title = `Custom Resume → ${aiLabel}`;

    // Sparkle / AI wand icon — no text, circular FAB
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <!-- Magic wand body -->
        <line x1="15" y1="9" x2="21" y2="3"/>
        <path d="M9.5 2.5 L7 5 L9.5 7.5 L12 5 Z"/>
        <!-- Sparkles -->
        <path d="M2 12l1.5 1.5L5 12l-1.5-1.5Z"/>
        <path d="M17 17l1 1 1-1-1-1Z"/>
        <!-- Wand tip line -->
        <line x1="3" y1="21" x2="15" y2="9"/>
      </svg>
    `;

    btn.style.cssText = `
      position:fixed;bottom:72px;right:24px;z-index:2147483645;
      width:44px;height:44px;
      background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;
      border:none;border-radius:50%;padding:0;
      display:flex;align-items:center;justify-content:center;
      cursor:pointer;
      box-shadow:0 4px 16px rgba(124,58,237,0.5);
      transition:transform 0.15s,box-shadow 0.15s,opacity 0.15s;
    `;

    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-3px) scale(1.08)';
      btn.style.boxShadow = '0 8px 24px rgba(124,58,237,0.65)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
      btn.style.boxShadow = '0 4px 16px rgba(124,58,237,0.5)';
    });
    btn.addEventListener('click', () => openAiChat(settings));
    document.body.appendChild(btn);
  }

  async function openAiChat(settings) {
    const jd = extractJobDescription();
    if (!jd) {
      showToast('Could not extract job description from this page.', 'info');
      return;
    }

    const template = settings.aiPromptTemplate || 'Customize my resume for this job:\n\n[JOB_DESCRIPTION]';
    const prompt = template.replace('[JOB_DESCRIPTION]', jd);

    const aiUrl = settings.preferredAI === 'gemini'
      ? 'https://gemini.google.com/app'
      : 'https://chatgpt.com/';

    try {
      await chrome.runtime.sendMessage({ type: 'OPEN_AI_CHAT', aiUrl, prompt });
      showToast(`✅ Opening ${settings.preferredAI === 'gemini' ? 'Gemini' : 'ChatGPT'} with your prompt. Attach your resume PDF and send!`, 'info');
    } catch (e) {
      showToast('Could not open AI chat. Try again.', 'info');
    }
  }

  // ── Init with retry / observer ─────────────────────────────────────────────

  async function init() {
    let settings;
    try {
      settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    } catch { return; }
    if (!settings) return;

    const platform = detectPlatform();

    // ── AI Resume button — only on job-related pages ──────────────────────
    const JOB_URL_PATTERN = /\/(job|jobs|career|careers|position|positions|opening|openings|vacancy|vacancies|role|roles|posting|postings|apply|application)\b/i;
    const JOB_HOSTNAMES   = [
      'linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com',
      'dice.com', 'wellfound.com', 'angel.co', 'monster.com', 'simplyhired.com',
      'myworkdayjobs.com', 'workday.com', 'greenhouse.io', 'lever.co',
      'icims.com', 'taleo.net', 'smartrecruiters.com', 'jobvite.com',
      'successfactors.com', 'brassring.com', 'careers.microsoft.com',
    ];
    const JOB_CONTENT_KEYWORDS = [
      'responsibilities', 'qualifications', 'requirements', 'years of experience',
      'what you\'ll do', 'about the role', 'minimum qualifications',
      'preferred qualifications', 'equal opportunity employer',
    ];

    function isJobPage() {
      const h = window.location.hostname;
      const p = window.location.pathname;
      // Known job board hostname
      if (JOB_HOSTNAMES.some(jh => h.includes(jh))) return true;
      // URL path contains job-related segment
      if (JOB_URL_PATTERN.test(p)) return true;
      // Subdomain hint: careers.*, jobs.*
      if (/^(careers|jobs|talent|work|hiring)\./.test(h)) return true;
      // Page content has ≥2 JD-specific phrases
      const text = document.body.innerText.toLowerCase().slice(0, 5000);
      const hits  = JOB_CONTENT_KEYWORDS.filter(kw => text.includes(kw)).length;
      return hits >= 2;
    }

    function tryShowAiBtn() {
      if (document.getElementById('jobtrackr-ai-btn')) return;
      if (isJobPage()) createCustomResumeButton(settings);
    }

    // Show immediately + retry for SPA pages that load content late
    tryShowAiBtn();
    let aiAttempts = 0;
    function retryAiBtn() {
      if (document.getElementById('jobtrackr-ai-btn')) return;
      tryShowAiBtn();
      if (++aiAttempts < 8) setTimeout(retryAiBtn, 1200);
    }
    setTimeout(retryAiBtn, 1200);

    // ── Autofill button — only when resume is saved ────────────────────────
    if (!settings.autofillEnabled) return;

    let resume;
    try {
      resume = await chrome.runtime.sendMessage({ type: 'GET_RESUME' });
    } catch { return; }
    if (!resume || (!resume.firstName && !resume.email)) return;

    function tryShowAutofill() {
      if (document.getElementById('jobtrackr-autofill-btn')) return true;
      if (isApplicationPage(platform)) {
        createAutoFillButton(resume, settings, platform);
        return true;
      }
      return false;
    }

    let attempts = 0;
    function retry() {
      if (tryShowAutofill()) return;
      if (++attempts < 19) setTimeout(retry, 800);
    }
    retry();

    const observer = new MutationObserver(() => {
      if (!document.getElementById('jobtrackr-autofill-btn') && isApplicationPage(platform)) {
        createAutoFillButton(resume, settings, platform);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('popstate', () => {
      document.getElementById('jobtrackr-autofill-btn')?.remove();
      setTimeout(retry, 1000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }
})();
