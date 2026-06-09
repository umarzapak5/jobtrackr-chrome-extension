// JobTrackr Service Worker — handles messages from content scripts and manages storage
// Note: storage/db.js exports via window.JobTrackrDB which is unavailable in a service worker context.
// Shared dedup / scoring / settings defaults live in storage/shared.js (self.JobTrackrShared).
importScripts('../storage/shared.js');
const SHARED = self.JobTrackrShared;

// Initialize storage on install
chrome.runtime.onInstalled.addListener(async () => {
  await initStorage();
  await purgePendingRecords();
  await updateBadge();
  await scheduleFollowUpAlarm();
  console.log('JobTrackr: Installed and storage initialized');
});

// One-time cleanup: remove legacy "Pending" records created by the old
// page-view tracking (these were never submitted applications).
async function purgePendingRecords() {
  try {
    const apps = await getAllApplications();
    const kept = apps.filter((a) => a.status !== 'Pending');
    if (kept.length !== apps.length) {
      await chrome.storage.local.set({ jobtrackr_applications: kept });
      console.log(`JobTrackr: removed ${apps.length - kept.length} legacy Pending record(s)`);
    }
  } catch (e) { /* ignore */ }
}

chrome.runtime.onStartup.addListener(async () => {
  await updateBadge();
  await scheduleFollowUpAlarm();
});

// ── Action badge: number of applications awaiting a response ─────────────────
// (status "Applied" — i.e. submitted but no interview/offer/rejection yet)
async function updateBadge() {
  try {
    const apps = await getAllApplications();
    const awaiting = apps.filter((a) => a.status === 'Applied').length;
    await chrome.action.setBadgeText({ text: awaiting > 0 ? String(awaiting) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#38bdf8' });
  } catch (e) { /* ignore */ }
}

// Recompute badge whenever the applications list changes, from any context
// (worker auto-detection, popup delete, dashboard edits, CSV import).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['jobtrackr_applications']) {
    updateBadge();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((e) => {
    console.error('JobTrackr SW error:', e);
    sendResponse({ error: e.message });
  });
  return true; // keep message channel open for async response
});

async function handleMessage(message, sender) {
  const { type } = message;

  if (type === 'APPLICATION_SUBMITTED') {
    return handleSubmission(message, sender);
  }

  if (type === 'GET_SETTINGS') {
    return getSettings();
  }

  if (type === 'GET_RESUME') {
    return getResume();
  }

  if (type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    return { ok: true };
  }

  if (type === 'OPEN_AI_CHAT') {
    const { aiUrl, prompt } = message;
    // Store prompt so ai-filler.js can read it when the tab loads
    await chrome.storage.local.set({ jobtrackr_pending_ai: { prompt, timestamp: Date.now() } });
    chrome.tabs.create({ url: aiUrl });
    return { ok: true };
  }

  return { error: 'Unknown message type' };
}

// Fired only when an application is actually submitted (confirmation detected).
// Creates the record directly as "Applied". No more Pending/page-view tracking.
async function handleSubmission(message, sender) {
  const settings = await getSettings();
  if (!settings.autoDetect) return { skipped: true };

  const { url, company, jobTitle, jobDescription, platform, location, jobType, salary } = message;

  // Skip if we already tracked this application (fuzzy dedup).
  const existing = await findDuplicate(url, company, jobTitle);
  if (existing) {
    return { alreadyApplied: true, id: existing.id, existingStatus: existing.status };
  }

  const now = new Date().toISOString();
  const app = await addApplication({
    jobTitle: jobTitle || 'Unknown Position',
    company: company || 'Unknown Company',
    platform: platform || 'other',
    applicationUrl: url || (sender.tab ? sender.tab.url : ''),
    location: location || '',
    jobType: jobType || '',
    salary: salary || '',
    jobDescription: jobDescription || '',
    dateFirstSeen: now,
    dateApplied: now,
    status: 'Applied',
    statusHistory: [{ status: 'Applied', date: now, note: 'Auto-detected application submission' }],
    detectedAutomatically: true,
  });

  return { created: true, id: app.id, app };
}

// Re-export DB functions for service worker scope
async function initStorage() {
  const data = await chrome.storage.local.get(['jobtrackr_applications', 'jobtrackr_settings']);
  const updates = {};
  if (!data['jobtrackr_applications']) updates['jobtrackr_applications'] = [];
  if (!data['jobtrackr_settings']) {
    updates['jobtrackr_settings'] = { ...SHARED.SETTINGS_DEFAULTS };
  }
  if (Object.keys(updates).length > 0) await chrome.storage.local.set(updates);
}

async function getSettings() {
  const data = await chrome.storage.local.get('jobtrackr_settings');
  return { ...SHARED.SETTINGS_DEFAULTS, ...(data['jobtrackr_settings'] || {}) };
}

async function getResume() {
  const data = await chrome.storage.local.get('jobtrackr_resume');
  return data['jobtrackr_resume'] || null;
}

async function getAllApplications() {
  const data = await chrome.storage.local.get('jobtrackr_applications');
  return data['jobtrackr_applications'] || [];
}

// ── Follow-up reminders (chrome.alarms) ──────────────────────────────────────
const FOLLOWUP_ALARM = 'jobtrackr_followup';

async function scheduleFollowUpAlarm() {
  try {
    // Run once on startup, then roughly daily.
    await chrome.alarms.create(FOLLOWUP_ALARM, { delayInMinutes: 1, periodInMinutes: 1440 });
  } catch (e) { /* ignore */ }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FOLLOWUP_ALARM) checkFollowUps();
});

async function checkFollowUps() {
  const settings = await getSettings();
  if (settings.followUpEnabled === false) return;
  const days = Number(settings.followUpDays) || 7;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const apps = await getAllApplications();
  let changed = false;

  for (const a of apps) {
    if (a.status !== 'Applied') continue;
    if (a.followUpNotified) continue;
    const appliedTs = new Date(a.dateApplied || a.updatedAt || a.createdAt || 0).getTime();
    if (!appliedTs || appliedTs > cutoff) continue;

    try {
      chrome.notifications.create(`followup_${a.id}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'JobTrackr — time to follow up',
        message: `It's been ${days}+ days since you applied to ${a.jobTitle || 'a role'} at ${a.company || 'a company'}. Consider sending a follow-up.`,
        priority: 1,
      });
    } catch (e) { /* notifications may be unavailable */ }

    a.followUpNotified = true;
    changed = true;
  }

  if (changed) await chrome.storage.local.set({ jobtrackr_applications: apps });
}

// Clicking a follow-up notification opens the dashboard.
chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith('followup_')) {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    chrome.notifications.clear(id);
  }
});

async function findDuplicate(url, company, jobTitle) {
  const apps = await getAllApplications();
  // Use the shared fuzzy matcher (single source of truth) so auto-detection
  // dedups "Full Stack Engineer" (LinkedIn) vs "Full-Stack Engineer" (Workday).
  return SHARED.findDuplicateIn(apps, url, company, jobTitle);
}

async function addApplication(appData) {
  const apps = await getAllApplications();
  const now = new Date().toISOString();
  const newApp = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, notes: '', ...appData };
  apps.push(newApp);
  await chrome.storage.local.set({ jobtrackr_applications: apps });
  return newApp;
}

async function promoteToApplied(id) {
  const apps = await getAllApplications();
  const idx = apps.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  apps[idx] = {
    ...apps[idx],
    status: 'Applied',
    dateApplied: now,
    updatedAt: now,
    statusHistory: [
      ...(apps[idx].statusHistory || []),
      { status: 'Applied', date: now, note: 'Auto-detected submission confirmation' },
    ],
  };
  await chrome.storage.local.set({ jobtrackr_applications: apps });
  return apps[idx];
}
