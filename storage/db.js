// Storage keys
const KEYS = {
  APPLICATIONS: 'jobtrackr_applications',
  RESUME: 'jobtrackr_resume',
  SETTINGS: 'jobtrackr_settings',
};

// Initialize storage with defaults if not set
async function initStorage() {
  const data = await chrome.storage.local.get([KEYS.APPLICATIONS, KEYS.SETTINGS]);
  const updates = {};
  if (!data[KEYS.APPLICATIONS]) {
    updates[KEYS.APPLICATIONS] = [];
  }
  if (!data[KEYS.SETTINGS]) {
    updates[KEYS.SETTINGS] = { ...((window.JobTrackrShared || {}).SETTINGS_DEFAULTS || {}) };
  }
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

async function getAllApplications() {
  try {
    const data = await chrome.storage.local.get(KEYS.APPLICATIONS);
    return data[KEYS.APPLICATIONS] || [];
  } catch (e) {
    console.error('JobTrackr: getAllApplications error', e);
    return [];
  }
}

async function addApplication(appData) {
  try {
    const apps = await getAllApplications();
    const now = new Date().toISOString();
    const newApp = {
      id: crypto.randomUUID(),
      jobTitle: '',
      company: '',
      platform: '',
      applicationUrl: '',
      location: '',
      jobType: '',
      salary: '',
      dateFirstSeen: now,
      dateApplied: now,
      status: 'Applied',
      statusHistory: [{ status: 'Applied', date: now, note: 'Application added' }],
      jobDescription: '',
      notes: '',
      detectedAutomatically: true,
      createdAt: now,
      updatedAt: now,
      ...appData,
    };
    apps.push(newApp);
    await chrome.storage.local.set({ [KEYS.APPLICATIONS]: apps });
    await checkStorageQuota();
    return newApp;
  } catch (e) {
    console.error('JobTrackr: addApplication error', e);
    throw e;
  }
}

async function updateApplication(id, changes) {
  try {
    const apps = await getAllApplications();
    const idx = apps.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    apps[idx] = { ...apps[idx], ...changes, updatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ [KEYS.APPLICATIONS]: apps });
    return apps[idx];
  } catch (e) {
    console.error('JobTrackr: updateApplication error', e);
    throw e;
  }
}

async function updateApplicationStatus(id, newStatus, note = '') {
  try {
    const apps = await getAllApplications();
    const idx = apps.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    const now = new Date().toISOString();
    const historyEntry = { status: newStatus, date: now, note };
    apps[idx] = {
      ...apps[idx],
      status: newStatus,
      statusHistory: [...(apps[idx].statusHistory || []), historyEntry],
      updatedAt: now,
    };
    await chrome.storage.local.set({ [KEYS.APPLICATIONS]: apps });
    return apps[idx];
  } catch (e) {
    console.error('JobTrackr: updateApplicationStatus error', e);
    throw e;
  }
}

async function promoteToApplied(id) {
  const now = new Date().toISOString();
  return updateApplication(id, {
    status: 'Applied',
    dateApplied: now,
    statusHistory: await getUpdatedHistory(id, 'Applied', 'Auto-detected submission confirmation'),
    updatedAt: now,
  });
}

async function getUpdatedHistory(id, newStatus, note) {
  const apps = await getAllApplications();
  const app = apps.find((a) => a.id === id);
  if (!app) return [];
  return [...(app.statusHistory || []), { status: newStatus, date: new Date().toISOString(), note }];
}

async function deleteApplication(id) {
  try {
    const apps = await getAllApplications();
    const filtered = apps.filter((a) => a.id !== id);
    await chrome.storage.local.set({ [KEYS.APPLICATIONS]: filtered });
    return true;
  } catch (e) {
    console.error('JobTrackr: deleteApplication error', e);
    return false;
  }
}

async function searchApplications(query) {
  const apps = await getAllApplications();
  if (!query) return apps;
  const q = query.toLowerCase();
  return apps.filter(
    (a) =>
      (a.jobTitle || '').toLowerCase().includes(q) ||
      (a.company || '').toLowerCase().includes(q) ||
      (a.platform || '').toLowerCase().includes(q)
  );
}

async function getApplicationsByStatus(status) {
  const apps = await getAllApplications();
  return apps.filter((a) => a.status === status);
}

// Duplicate detection delegates to the shared module (single source of truth).
const SHARED = (typeof window !== 'undefined' && window.JobTrackrShared) || {};

async function findDuplicate(url, company, jobTitle) {
  const apps = await getAllApplications();
  return SHARED.findDuplicateIn(apps, url, company, jobTitle);
}

async function exportToCSV() {
  const apps = await getAllApplications();
  const headers = [
    'ID', 'Job Title', 'Company', 'Platform', 'URL', 'Location', 'Job Type',
    'Salary', 'Date First Seen', 'Date Applied', 'Status', 'Notes', 'Created At',
    'Job Description',
  ];
  const rows = apps.map((a) => [
    a.id, a.jobTitle, a.company, a.platform, a.applicationUrl, a.location,
    a.jobType, a.salary, a.dateFirstSeen, a.dateApplied || '', a.status,
    (a.notes || '').replace(/"/g, '""'), a.createdAt,
    (a.jobDescription || '').replace(/"/g, '""'),
  ]);
  const escape = (v) => `"${(v || '').toString().replace(/"/g, '""')}"`;
  const csvContent = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  return csvContent;
}

// Full-fidelity JSON backup: preserves statusHistory, jobDescription, all fields.
async function exportToJSON() {
  const apps = await getAllApplications();
  const settings = await getSettings();
  const resume = await getResume();
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    applications: apps,
    settings,
    resume,
  }, null, 2);
}

// Restore from a JSON backup. Merges applications (skips duplicates by id),
// and optionally restores settings/resume.
async function importFromJSON(jsonText, opts = {}) {
  let data;
  try { data = JSON.parse(jsonText); } catch (e) { throw new Error('Invalid JSON file'); }
  const incoming = Array.isArray(data) ? data : (data.applications || []);
  const existing = await getAllApplications();
  const byId = new Set(existing.map((a) => a.id));
  let imported = 0, skipped = 0;
  const merged = existing.slice();

  for (const app of incoming) {
    if (app.id && byId.has(app.id)) { skipped++; continue; }
    // Also skip fuzzy duplicates from the merged set.
    if (SHARED.findDuplicateIn(merged, app.applicationUrl, app.company, app.jobTitle)) { skipped++; continue; }
    const rec = { ...app, id: app.id || crypto.randomUUID() };
    merged.push(rec);
    byId.add(rec.id);
    imported++;
  }
  await chrome.storage.local.set({ [KEYS.APPLICATIONS]: merged });

  if (opts.restoreSettings && data.settings) await saveSettings({ ...SETTINGS_DEFAULTS, ...data.settings });
  if (opts.restoreResume && data.resume)   await saveResume(data.resume);

  return { imported, skipped };
}

async function importFromCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return { imported: 0, skipped: 0 };
  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
  let imported = 0;
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    const existing = await findDuplicate(row['url'], row['company'], row['job title']);
    if (existing) { skipped++; continue; }
    await addApplication({
      jobTitle: row['job title'] || '',
      company: row['company'] || '',
      platform: row['platform'] || '',
      applicationUrl: row['url'] || '',
      location: row['location'] || '',
      jobType: row['job type'] || '',
      salary: row['salary'] || '',
      dateFirstSeen: row['date first seen'] || new Date().toISOString(),
      dateApplied: row['date applied'] || null,
      status: row['status'] || 'Applied',
      notes: row['notes'] || '',
      jobDescription: row['job description'] || '',
      detectedAutomatically: false,
    });
    imported++;
  }
  return { imported, skipped };
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (line[i] === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += line[i];
    }
  }
  result.push(current);
  return result;
}

const DEFAULT_AI_PROMPT = SHARED.DEFAULT_AI_PROMPT;
const SETTINGS_DEFAULTS = SHARED.SETTINGS_DEFAULTS;

async function getSettings() {
  try {
    const data = await chrome.storage.local.get(KEYS.SETTINGS);
    return { ...SETTINGS_DEFAULTS, ...(data[KEYS.SETTINGS] || {}) };
  } catch (e) {
    return { ...SETTINGS_DEFAULTS };
  }
}

async function saveSettings(settings) {
  try {
    await chrome.storage.local.set({ [KEYS.SETTINGS]: settings });
    return true;
  } catch (e) {
    console.error('JobTrackr: saveSettings error', e);
    return false;
  }
}

async function getResume() {
  try {
    const data = await chrome.storage.local.get(KEYS.RESUME);
    return data[KEYS.RESUME] || null;
  } catch (e) {
    return null;
  }
}

async function saveResume(resumeData) {
  try {
    const now = new Date().toISOString();
    await chrome.storage.local.set({ [KEYS.RESUME]: { ...resumeData, lastUpdated: now } });
    return true;
  } catch (e) {
    console.error('JobTrackr: saveResume error', e);
    return false;
  }
}

async function checkStorageQuota() {
  try {
    const usage = await chrome.storage.local.getBytesInUse(null);
    const quota = chrome.storage.local.QUOTA_BYTES || 10485760;
    if (usage / quota > 0.8) {
      console.warn('JobTrackr: Storage over 80% full');
      return { warning: true, usage, quota, percent: Math.round((usage / quota) * 100) };
    }
    return { warning: false, usage, quota, percent: Math.round((usage / quota) * 100) };
  } catch (e) {
    return { warning: false };
  }
}

async function getPendingAiPrompt() {
  try {
    const data = await chrome.storage.local.get('jobtrackr_pending_ai');
    return data['jobtrackr_pending_ai'] || null;
  } catch (e) { return null; }
}

async function setPendingAiPrompt(payload) {
  try {
    await chrome.storage.local.set({ jobtrackr_pending_ai: payload });
  } catch (e) { console.error('JobTrackr: setPendingAiPrompt error', e); }
}

async function clearPendingAiPrompt() {
  try {
    await chrome.storage.local.remove('jobtrackr_pending_ai');
  } catch (e) { /* ignore */ }
}

// Export for use as module in dashboard/popup contexts
if (typeof window !== 'undefined') {
  window.JobTrackrDB = {
    initStorage, getAllApplications, addApplication, updateApplication,
    updateApplicationStatus, promoteToApplied, deleteApplication,
    searchApplications, getApplicationsByStatus, findDuplicate,
    exportToCSV, importFromCSV, exportToJSON, importFromJSON, getSettings, saveSettings,
    getResume, saveResume, checkStorageQuota,
    getPendingAiPrompt, setPendingAiPrompt, clearPendingAiPrompt,
    KEYS, DEFAULT_AI_PROMPT,
  };
}
