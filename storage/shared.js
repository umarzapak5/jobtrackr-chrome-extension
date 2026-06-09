// JobTrackr — Shared module (single source of truth)
// Loaded in ALL contexts:
//   • Service worker  → via importScripts('../storage/shared.js')
//   • Content scripts → first entry in manifest content_scripts
//   • Popup/Dashboard → <script src="../storage/shared.js"> before db.js
//
// Attaches to the global object (`self` in workers, `window` in pages) as
// `JobTrackrShared`. Keeping dedup / JD-scoring / settings defaults here
// prevents the copies in worker, detector, autofill and popup from drifting.
(function (root) {
  'use strict';

  // ── Settings defaults ──────────────────────────────────────────────────────
  const DEFAULT_AI_PROMPT =
`Please help me customize my resume for the job posting below. I will attach my resume PDF.

Analyze the job description and:
1. Identify the top skills and requirements I should highlight
2. Suggest specific bullet points to strengthen based on the role
3. Recommend which experiences to prioritize
4. List important ATS keywords to incorporate

JOB DESCRIPTION:
[JOB_DESCRIPTION]`;

  const SETTINGS_DEFAULTS = {
    autoDetect: true,
    showToastOnDetect: true,
    autofillEnabled: true,
    exportFormat: 'csv',
    // EEO & Work Authorization profile
    gender: 'Prefer not to say',
    veteranStatus: 'I am not a protected veteran',
    disabilityStatus: 'No, I do not have a disability',
    hispanicLatino: 'No, not Hispanic or Latino',
    ethnicity: 'Asian (Not Hispanic or Latino)',
    workAuthorization: 'Green Card / Permanent Resident',
    requireSponsorship: 'No',
    citizenshipCountry: 'United States',
    // AI Resume helper
    preferredAI: 'chatgpt',
    aiPromptTemplate: DEFAULT_AI_PROMPT,
    // Follow-up reminders
    followUpDays: 7,
    followUpEnabled: true,
  };

  // ── Fuzzy duplicate detection ──────────────────────────────────────────────
  // Normalize a string: lowercase, strip non-alphanumeric.
  function normStr(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Fuzzy match: exact, containment, or ≥6-char prefix match.
  function fuzzyMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    const shorter = a.length < b.length ? a : b;
    const longer  = a.length < b.length ? b : a;
    return shorter.length >= 6 && longer.startsWith(shorter);
  }

  // Find an existing application that duplicates (url, company, jobTitle).
  // `apps` is the full applications array. Returns the matching record or undefined.
  function findDuplicateIn(apps, url, company, jobTitle) {
    const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const normUrl     = (url || '').trim();
    const normCompany = normStr(company);
    const normTitle   = normStr(jobTitle);

    return apps.find((a) => {
      const ts = new Date(a.createdAt || a.dateFirstSeen || 0).getTime();
      if (ts < sixtyDaysAgo) return false;

      // 1. Exact URL match
      if (normUrl && a.applicationUrl && a.applicationUrl === normUrl) return true;

      // 2. Fuzzy company + fuzzy title
      if (normCompany && normTitle) {
        if (fuzzyMatch(normCompany, normStr(a.company)) &&
            fuzzyMatch(normTitle, normStr(a.jobTitle))) return true;
      }
      return false;
    });
  }

  // ── JD quality scoring ──────────────────────────────────────────────────────
  const JD_KEYWORDS = [
    'responsibilities', 'qualifications', 'requirements', "what you'll do",
    'what you will do', 'who you are', 'about the role', 'about this role',
    'minimum qualifications', 'preferred qualifications', 'years of experience',
    'we are looking', 'the ideal candidate', 'skills required', 'key skills',
    'job description', 'position summary', 'essential functions', 'education required',
    'compensation', 'salary', 'benefits', 'what we offer', "you'll bring",
    'you will', 'we offer', 'equal opportunity',
  ];

  const NOISE_PHRASES = [
    'cookie', 'accept all', 'reject all', 'privacy policy', 'terms of use',
    'sign in', 'log in', 'create account', 'modify cookie', 'functional cookies',
    'optional cookies', 'gdpr', 'data protection', 'skip to main content',
    'keyboard shortcuts', 'loading job details', 'loading...',
    'you are on the messaging overlay', 'press enter to open',
  ];

  const LOADING_PHRASES = [
    'loading job details', 'loading...', 'please wait', 'fetching job',
    'job details loading',
  ];

  function jdScore(text) {
    if (!text) return -999;
    const lower = text.toLowerCase();
    let score = 0;
    for (const kw of JD_KEYWORDS) { if (lower.includes(kw)) score += 15; }
    score += Math.min(text.length / 80, 60);
    let noiseHits = 0;
    for (const ph of NOISE_PHRASES) { if (lower.includes(ph)) noiseHits++; }
    score -= noiseHits * 25;
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const avgLen = text.length / Math.max(lines.length, 1);
    if (avgLen < 20) score -= 40;
    return score;
  }

  function isLoadingContent(text) {
    const lower = (text || '').toLowerCase();
    return LOADING_PHRASES.some(p => lower.includes(p));
  }

  // ── Skill-gap matching (resume vs JD) ───────────────────────────────────────
  // Returns { matched: [...], missing: [...] } comparing resume skills to JD text.
  function skillGap(resumeSkills, jdText) {
    const skills = (resumeSkills || []).map(s => (s || '').trim()).filter(Boolean);
    const lowerJD = (jdText || '').toLowerCase();
    const matched = [];
    const missingFromResume = [];
    // Which of my resume skills are mentioned in the JD?
    for (const sk of skills) {
      if (lowerJD.includes(sk.toLowerCase())) matched.push(sk);
    }
    // Extract candidate skill tokens from the JD that are NOT on my resume.
    const lowerSkillSet = new Set(skills.map(s => s.toLowerCase()));
    const TECH_TOKENS = [
      'java', 'javascript', 'typescript', 'python', 'c#', 'c++', '.net', 'go', 'golang',
      'ruby', 'php', 'kotlin', 'swift', 'scala', 'rust', 'react', 'angular', 'vue',
      'node', 'node.js', 'express', 'spring', 'django', 'flask', 'rails', '.net core',
      'sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'oracle', 'nosql', 'graphql',
      'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'jenkins', 'ci/cd',
      'git', 'agile', 'scrum', 'rest', 'microservices', 'kafka', 'rabbitmq', 'linux',
      'html', 'css', 'sass', 'webpack', 'jest', 'cypress', 'selenium', 'devops',
      'machine learning', 'tensorflow', 'pytorch', 'pandas', 'spark', 'hadoop',
      'power bi', 'tableau', 'jira', 'confluence', 'servicenow', 'sharepoint',
    ];
    for (const tok of TECH_TOKENS) {
      if (lowerJD.includes(tok) && !lowerSkillSet.has(tok)) {
        // Avoid substring false-positives like "go" in "category"
        const re = new RegExp(`(^|[^a-z0-9+#.])${tok.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9+#.]|$)`, 'i');
        if (re.test(lowerJD)) missingFromResume.push(tok);
      }
    }
    return { matched, missing: missingFromResume };
  }

  root.JobTrackrShared = {
    DEFAULT_AI_PROMPT, SETTINGS_DEFAULTS,
    normStr, fuzzyMatch, findDuplicateIn,
    JD_KEYWORDS, NOISE_PHRASES, LOADING_PHRASES, jdScore, isLoadingContent,
    skillGap,
  };
})(typeof self !== 'undefined' ? self : this);
