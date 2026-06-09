/**
 * JobTrackr Dashboard
 * Wrapped in an IIFE so local let/const names don't collide with globals
 * declared by helpers.js (STATUS_CONFIG, ALL_STATUSES, PLATFORM_CONFIG, etc.)
 */
(function () {
  'use strict';

  // ── Module-level state (function-scoped, no global collision) ───────────
  let DB = null;
  let H = null;
  // Shorthand aliases — set in init() from H
  let SC, PC, AS, ago, fmtDate, dlFile, dbounce;

  // Interview-stage statuses — pinned to the top of the list and highlighted.
  const HOT_STATUSES = ['Phone Screen', 'Technical', 'Final Round'];

  let allApps = [];
  let filteredApps = [];
  let currentView = 'kanban';
  let sortCol = 'createdAt';
  let sortDir = 'desc';
  let activeFilters = { search: '', status: '', platform: '', days: '' };
  let currentDetailId = null;
  let showArchived = false;
  let parsedResume = null;
  let draggedCardId = null;
  let currentSkills = [];
  let experienceEntries = [];
  let educationEntries = [];
  let certEntries = [];

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    try {
      DB = window.JobTrackrDB;
      H  = window.JobTrackrHelpers;

      if (!DB) { showFatalError('Storage module (db.js) failed to load.'); return; }
      if (!H)  { showFatalError('Helpers module (helpers.js) failed to load.'); return; }

      // Assign shorthand aliases
      SC      = H.STATUS_CONFIG;
      PC      = H.PLATFORM_CONFIG;
      AS      = H.ALL_STATUSES;
      ago     = H.timeAgo;
      fmtDate = H.formatDate;
      dlFile  = H.downloadFile;
      dbounce = H.debounce;

      bindEvents();          // Attach all listeners first so UI is responsive
      await loadApps();
      await loadResumeTab();
      await loadSettings();

      // Deep-link: open detail modal if ?id= param
      const params = new URLSearchParams(window.location.search);
      if (params.has('id')) openDetailModal(params.get('id'));

    } catch (err) {
      console.error('JobTrackr dashboard init error:', err);
      showFatalError('Dashboard failed to start: ' + err.message);
    }
  }

  function showFatalError(msg) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);background:#7f1d1d;color:#fca5a5;padding:16px 24px;border-radius:10px;font-size:13px;z-index:9999;max-width:500px;text-align:center';
    el.textContent = '⚠ ' + msg;
    document.body.appendChild(el);
  }

  // ── Data loading ──────────────────────────────────────────────────────────
  async function loadApps() {
    try {
      allApps = await DB.getAllApplications();
    } catch (e) {
      console.error('loadApps error:', e);
      allApps = [];
    }
    applyFilters();
  }

  function applyFilters() {
    let apps = [...allApps];
    const { search, status, platform, days } = activeFilters;

    if (showArchived) {
      apps = apps.filter(a => a.archived === true);
    } else {
      apps = apps.filter(a => a.archived !== true);
    }

    if (search) {
      const q = search.toLowerCase();
      apps = apps.filter(a => (a.jobTitle + ' ' + a.company).toLowerCase().includes(q));
    }
    if (status)   apps = apps.filter(a => a.status === status);
    if (platform) apps = apps.filter(a => (a.platform || '').toLowerCase() === platform);
    if (days) {
      const cutoff = Date.now() - parseInt(days) * 86400000;
      apps = apps.filter(a => new Date(a.createdAt || a.dateFirstSeen).getTime() > cutoff);
    }

    filteredApps = apps;
    renderCurrentView();
  }

  function renderCurrentView() {
    if (currentView === 'kanban') renderKanban();
    else renderTable();
  }

  // ── Kanban ────────────────────────────────────────────────────────────────
  function renderKanban() {
    const board = document.getElementById('kanbanBoard');
    if (!board) return;
    board.innerHTML = '';

    const grouped = {};
    AS.forEach(s => { grouped[s] = []; });
    filteredApps.forEach(a => {
      const s = grouped[a.status] !== undefined ? a.status : 'Applied';
      grouped[s].push(a);
    });

    AS.forEach(status => {
      const cfg  = SC[status];
      const apps = grouped[status] || [];

      const col = document.createElement('div');
      col.className = 'kanban-col';

      col.innerHTML = `
        <div class="kanban-col-header">
          <span class="kanban-col-title">
            <span class="kanban-col-dot" style="background:${cfg.color}"></span>
            ${esc(cfg.label)}
          </span>
          <span class="kanban-col-count">${apps.length}</span>
        </div>
        <div class="kanban-col-cards" data-status="${esc(status)}"></div>
      `;

      const cards = col.querySelector('.kanban-col-cards');
      apps.forEach(app => cards.appendChild(makeKanbanCard(app)));

      cards.addEventListener('dragover', e => { e.preventDefault(); cards.classList.add('drag-over'); });
      cards.addEventListener('dragleave', () => cards.classList.remove('drag-over'));
      cards.addEventListener('drop', async e => {
        e.preventDefault();
        cards.classList.remove('drag-over');
        if (draggedCardId) {
          await DB.updateApplicationStatus(draggedCardId, status, 'Moved via drag-and-drop');
          await loadApps();
        }
      });

      board.appendChild(col);
    });
  }

  function makeKanbanCard(app) {
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.draggable = true;
    card.dataset.id = app.id;

    const pk  = (app.platform || 'other').toLowerCase();
    const pcf = PC[pk] || PC['other'];
    const ds  = app.dateApplied || app.dateFirstSeen || app.createdAt;

    card.innerHTML = `
      <div class="kcard-company">${esc(app.company || 'Unknown Company')}</div>
      <div class="kcard-title">${esc(app.jobTitle || 'Unknown Position')}</div>
      <div class="kcard-footer">
        <span class="badge" style="color:${pcf.color};background:${pcf.bg}">${esc(pcf.label)}</span>
        <span class="kcard-date">${ago(ds)}</span>
      </div>
    `;

    card.addEventListener('dragstart', () => { draggedCardId = app.id; card.classList.add('dragging'); });
    card.addEventListener('dragend',   () => { draggedCardId = null;   card.classList.remove('dragging'); });
    card.addEventListener('click', () => openDetailModal(app.id));
    return card;
  }

  // ── Table view ────────────────────────────────────────────────────────────
  function renderTable() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const sorted = [...filteredApps].sort((a, b) => {
      // Interview-stage jobs always pinned to top regardless of column sort.
      const ha = HOT_STATUSES.includes(a.status), hb = HOT_STATUSES.includes(b.status);
      if (ha !== hb) return ha ? -1 : 1;
      const va = (a[sortCol] || '').toString().toLowerCase();
      const vb = (b[sortCol] || '').toString().toLowerCase();
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });

    if (!sorted.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:40px">No applications found.</td></tr>`;
      return;
    }

    sorted.forEach(app => {
      const scf = SC[app.status] || SC['Applied'];
      const pk  = (app.platform || 'other').toLowerCase();
      const pcf = PC[pk] || PC['other'];
      const ds  = app.dateApplied || app.dateFirstSeen || '';

      const tr = document.createElement('tr');
      if (HOT_STATUSES.includes(app.status)) tr.className = 'table-row--hot';
      tr.innerHTML = `
        <td class="table-company">${esc(app.company || '—')}</td>
        <td class="table-title">${esc(app.jobTitle || '—')}</td>
        <td><span class="badge" style="color:${pcf.color};background:${pcf.bg}">${esc(pcf.label)}</span></td>
        <td style="color:var(--text-secondary)">${esc(app.location || '—')}</td>
        <td style="color:var(--text-secondary);white-space:nowrap">${ds ? fmtDate(ds) : '—'}</td>
        <td><span class="badge" style="color:${scf.color};background:${scf.bg}">${esc(scf.label)}</span></td>
        <td class="table-notes" title="${esc(app.notes || '')}">${esc(app.notes || '—')}</td>
        <td>
          <div class="table-actions">
            <button class="action-btn" data-action="open" data-id="${app.id}">Open</button>
            <button class="action-btn del" data-action="del"  data-id="${app.id}">Delete</button>
          </div>
        </td>
      `;
      tr.addEventListener('click', e => {
        if (e.target.dataset.action) return;
        openDetailModal(app.id);
      });
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('[data-action="open"]').forEach(btn =>
      btn.addEventListener('click', e => { e.stopPropagation(); openDetailModal(btn.dataset.id); })
    );
    tbody.querySelectorAll('[data-action="del"]').forEach(btn =>
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (confirm('Delete this application?')) {
          await DB.deleteApplication(btn.dataset.id);
          await loadApps();
        }
      })
    );
  }

  // ── Detail modal ──────────────────────────────────────────────────────────
  function openDetailModal(id) {
    const app = allApps.find(a => a.id === id);
    if (!app) return;
    currentDetailId = id;

    const archiveBtn = document.getElementById('detailArchive');
    if (archiveBtn) {
      archiveBtn.textContent = app.archived ? 'Unarchive' : 'Archive';
    }

    document.getElementById('detailTitle').value   = app.jobTitle || '';
    document.getElementById('detailCompany').value = app.company  || '';
    document.getElementById('detailNotes').value         = app.notes    || '';

    const sel = document.getElementById('detailStatusSelect');
    sel.innerHTML = AS.map(s =>
      `<option value="${s}"${s === app.status ? ' selected' : ''}>${s}</option>`
    ).join('');

    const pk  = (app.platform || 'other').toLowerCase();
    const pcf = PC[pk] || PC['other'];
    document.getElementById('detailMeta').innerHTML = [
      `<div class="detail-meta-item">${esc(app.location || 'Location unknown')}</div>`,
      `<div class="detail-meta-item">${esc(pcf.label)}</div>`,
      `<div class="detail-meta-item">${app.dateApplied ? 'Applied ' + fmtDate(app.dateApplied) : 'Not yet applied'}</div>`,
      app.applicationUrl ? `<div class="detail-meta-item"><a href="${esc(app.applicationUrl)}" target="_blank" style="color:var(--accent)">View listing ↗</a></div>` : '',
    ].join('');

    const history = document.getElementById('detailHistory');
    const entries = (app.statusHistory || []).slice().reverse();
    history.innerHTML = entries.length
      ? entries.map(h => `
          <div class="history-entry">
            <div class="history-dot"></div>
            <div>
              <div class="history-text">${esc(h.status)}${h.note ? ' — ' + esc(h.note) : ''}</div>
              <div class="history-date">${fmtDate(h.date)}</div>
            </div>
          </div>`).join('')
      : '<span style="color:var(--text-muted);font-size:12px">No history yet.</span>';

    document.getElementById('detailJD').textContent = app.jobDescription || 'No job description captured.';
    document.getElementById('detailModal').style.display = 'flex';

    // Reset outreach states
    const resultBox = document.getElementById('outreachResultBox');
    if (resultBox) resultBox.style.display = 'none';
    const outreachText = document.getElementById('outreachText');
    if (outreachText) outreachText.value = '';

    renderInterviewPrep(app);

    renderSkillGap(app).catch(console.error);
  }

  // ── Resume ↔ JD skill-gap matching ─────────────────────────────────────────
  async function renderSkillGap(app) {
    const panel = document.getElementById('detailSkillGap');
    const SH = window.JobTrackrShared;
    if (!panel || !SH || !SH.skillGap) { if (panel) panel.style.display = 'none'; return; }

    const jd = app.jobDescription || '';
    let resume = null;
    try { resume = await DB.getResume(); } catch (e) { /* ignore */ }

    const skills = (resume && Array.isArray(resume.skills)) ? resume.skills : [];
    if (!jd || jd.length < 100 || skills.length === 0) {
      panel.style.display = 'none';
      return;
    }

    const { matched, missing } = SH.skillGap(skills, jd);
    const total = matched.length + missing.length;
    const pct = total > 0 ? Math.round((matched.length / total) * 100) : 0;

    document.getElementById('skillGapPct').textContent = pct + '%';
    const chip = (t, cls) => `<span class="skill-chip ${cls}">${esc(t)}</span>`;
    document.getElementById('skillGapMatched').innerHTML =
      matched.length ? matched.map(s => chip(s, 'skill-chip--matched')).join('') :
      '<span class="skill-gap-empty">None of your listed skills appear verbatim.</span>';
    document.getElementById('skillGapMissing').innerHTML =
      missing.length ? missing.map(s => chip(s, 'skill-chip--missing')).join('') :
      '<span class="skill-gap-empty">No notable gaps detected. 🎉</span>';

    panel.style.display = 'block';
  }

  function closeDetailModal() {
    document.getElementById('detailModal').style.display = 'none';
    currentDetailId = null;
  }

  // ── Resume tab ────────────────────────────────────────────────────────────
  async function loadResumeTab() {
    try {
      const saved = await DB.getResume();
      if (saved && (saved.email || saved.firstName)) {
        parsedResume = saved;
        showResumeState('saved');
        renderSavedResume(saved);
      } else {
        showResumeState('upload');
      }
    } catch (e) {
      console.error('loadResumeTab error:', e);
      showResumeState('upload');
    }
  }

  function showResumeState(state) {
    document.getElementById('resumeUploadState').style.display = state === 'upload' ? 'block' : 'none';
    document.getElementById('resumeEditState').style.display   = state === 'edit'   ? 'block' : 'none';
    document.getElementById('resumeSavedState').style.display  = state === 'saved'  ? 'block' : 'none';
  }

  function renderSavedResume(r) {
    document.getElementById('savedName').textContent  = [r.firstName, r.lastName].filter(Boolean).join(' ') || 'No name';
    document.getElementById('savedTitle').textContent = r.currentTitle || 'No title';
    document.getElementById('savedUpdated').textContent = r.lastUpdated ? 'Last updated: ' + fmtDate(r.lastUpdated) : '';

    document.getElementById('savedDetails').innerHTML = [
      r.email         && `<div class="saved-detail-item"><strong>Email:</strong> ${esc(r.email)}</div>`,
      r.phone         && `<div class="saved-detail-item"><strong>Phone:</strong> ${esc(r.phone)}</div>`,
      r.address?.city && `<div class="saved-detail-item"><strong>Location:</strong> ${esc([r.address.city, r.address.state].filter(Boolean).join(', '))}</div>`,
      r.linkedinUrl   && `<div class="saved-detail-item"><strong>LinkedIn:</strong> <a href="${esc(r.linkedinUrl)}" target="_blank" style="color:var(--accent)">${esc(r.linkedinUrl)}</a></div>`,
    ].filter(Boolean).join('');

    document.getElementById('savedSkills').innerHTML = (r.skills || []).slice(0, 20)
      .map(s => `<span class="skill-chip">${esc(s)}</span>`).join('');
  }

  function populateResumeEditForm(r) {
    const sv = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    sv('rFirstName', r.firstName);  sv('rLastName', r.lastName);
    sv('rEmail', r.email);          sv('rPhone', r.phone);
    sv('rLinkedin', r.linkedinUrl); sv('rGithub', r.githubUrl);
    sv('rPortfolio', r.portfolioUrl); sv('rCurrentTitle', r.currentTitle);
    sv('rSummary', r.summary);
    sv('rCity', r.address?.city);   sv('rState', r.address?.state);
    sv('rZip', r.address?.zip);     sv('rCountry', r.address?.country);
    renderSkillTags(r.skills || []);
    renderExperience(r.experience || []);
    renderEducation(r.education || []);
    renderCerts(r.certifications || []);
  }

  function renderSkillTags(skills) {
    currentSkills = [...skills];
    const container = document.getElementById('skillsTags');
    container.innerHTML = '';
    currentSkills.forEach((skill, idx) => {
      const chip = document.createElement('span');
      chip.className = 'skill-chip';
      chip.innerHTML = `${esc(skill)}<button class="skill-chip-remove" title="Remove">×</button>`;
      chip.querySelector('.skill-chip-remove').addEventListener('click', () => {
        currentSkills.splice(idx, 1);
        renderSkillTags(currentSkills);
      });
      container.appendChild(chip);
    });
  }

  function renderExperience(entries) {
    experienceEntries = entries.map(e => ({ ...e }));
    const c = document.getElementById('experienceList');
    c.innerHTML = '';
    experienceEntries.forEach((entry, idx) => c.appendChild(makeExpCard(entry, idx)));
  }

  function makeExpCard(entry, idx) {
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.innerHTML = `
      <button class="entry-delete" title="Delete">×</button>
      <div class="entry-card-grid">
        <div class="entry-card-field"><label>Company</label><input type="text" class="f-company" value="${esc(entry.company || '')}"></div>
        <div class="entry-card-field"><label>Role / Title</label><input type="text" class="f-role" value="${esc(entry.role || '')}"></div>
        <div class="entry-card-field"><label>Start Date</label><input type="text" class="f-start" placeholder="Jan 2020" value="${esc(entry.startDate || '')}"></div>
        <div class="entry-card-field"><label>End Date</label><input type="text" class="f-end" placeholder="Present" value="${esc(entry.endDate || '')}"></div>
      </div>
      <div class="entry-card-field"><label>Description</label><textarea class="f-desc" rows="3">${esc(entry.description || '')}</textarea></div>
    `;
    card.querySelector('.entry-delete').addEventListener('click', () => {
      experienceEntries.splice(idx, 1);
      renderExperience(experienceEntries);
    });
    return card;
  }

  function renderEducation(entries) {
    educationEntries = entries.map(e => ({ ...e }));
    const c = document.getElementById('educationList');
    c.innerHTML = '';
    educationEntries.forEach((entry, idx) => c.appendChild(makeEduCard(entry, idx)));
  }

  function makeEduCard(entry, idx) {
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.innerHTML = `
      <button class="entry-delete" title="Delete">×</button>
      <div class="entry-card-grid">
        <div class="entry-card-field"><label>Institution</label><input type="text" class="f-institution" value="${esc(entry.institution || '')}"></div>
        <div class="entry-card-field"><label>Degree</label><input type="text" class="f-degree" value="${esc(entry.degree || '')}"></div>
        <div class="entry-card-field"><label>Field of Study</label><input type="text" class="f-field" value="${esc(entry.field || '')}"></div>
        <div class="entry-card-field"><label>Start Date</label><input type="text" class="f-start" value="${esc(entry.startDate || '')}"></div>
        <div class="entry-card-field"><label>End Date</label><input type="text" class="f-end" value="${esc(entry.endDate || '')}"></div>
      </div>
    `;
    card.querySelector('.entry-delete').addEventListener('click', () => {
      educationEntries.splice(idx, 1);
      renderEducation(educationEntries);
    });
    return card;
  }

  function renderCerts(certs) {
    certEntries = [...certs];
    const c = document.getElementById('certList');
    c.innerHTML = '';
    certEntries.forEach((cert, idx) => {
      const row = document.createElement('div');
      row.className = 'cert-row';
      row.innerHTML = `<input type="text" value="${esc(cert)}" placeholder="Certification name"><button class="cert-remove" title="Remove">×</button>`;
      row.querySelector('.cert-remove').addEventListener('click', () => {
        certEntries.splice(idx, 1);
        renderCerts(certEntries);
      });
      c.appendChild(row);
    });
  }

  function collectResumeData() {
    const q = (sel, cls) => Array.from(document.querySelectorAll(sel + ' ' + cls));
    const experience = q('#experienceList', '.entry-card').map(card => ({
      company:     card.querySelector('.f-company')?.value.trim()  || '',
      role:        card.querySelector('.f-role')?.value.trim()     || '',
      startDate:   card.querySelector('.f-start')?.value.trim()    || '',
      endDate:     card.querySelector('.f-end')?.value.trim()      || '',
      description: card.querySelector('.f-desc')?.value.trim()     || '',
    }));
    const education = q('#educationList', '.entry-card').map(card => ({
      institution: card.querySelector('.f-institution')?.value.trim() || '',
      degree:      card.querySelector('.f-degree')?.value.trim()      || '',
      field:       card.querySelector('.f-field')?.value.trim()       || '',
      startDate:   card.querySelector('.f-start')?.value.trim()       || '',
      endDate:     card.querySelector('.f-end')?.value.trim()         || '',
    }));
    const certifications = q('#certList', 'input').map(i => i.value.trim()).filter(Boolean);

    const gv = id => (document.getElementById(id) || {}).value?.trim() || '';
    return {
      firstName: gv('rFirstName'), lastName: gv('rLastName'),
      email: gv('rEmail'),         phone: gv('rPhone'),
      linkedinUrl: gv('rLinkedin'), githubUrl: gv('rGithub'),
      portfolioUrl: gv('rPortfolio'), currentTitle: gv('rCurrentTitle'),
      summary: gv('rSummary'),
      address: { city: gv('rCity'), state: gv('rState'), zip: gv('rZip'), country: gv('rCountry') },
      skills: [...currentSkills], experience, education, certifications,
    };
  }

  // ── Settings tab ──────────────────────────────────────────────────────────
  function setSelect(id, value) {
    const el = document.getElementById(id);
    if (!el || !value) return;
    // Try exact match first, then partial
    for (const opt of el.options) {
      if (opt.value === value || opt.text === value) { el.value = opt.value; return; }
    }
    const lower = value.toLowerCase();
    for (const opt of el.options) {
      if (opt.text.toLowerCase().includes(lower) || lower.includes(opt.text.toLowerCase())) {
        el.value = opt.value; return;
      }
    }
  }

  async function loadSettings() {
    try {
      const s = await DB.getSettings();
      const el = id => document.getElementById(id);
      if (el('settingAutoDetect')) el('settingAutoDetect').checked = !!s.autoDetect;
      if (el('settingToast'))      el('settingToast').checked      = !!s.showToastOnDetect;
      if (el('settingAutofill'))   el('settingAutofill').checked   = !!s.autofillEnabled;

      // AI settings
      const aiPromptEl = document.getElementById('settingAiPrompt');
      if (aiPromptEl) aiPromptEl.value = s.aiPromptTemplate || '';
      setAiToggle(s.preferredAI || 'chatgpt');

      // EEO fields
      setSelect('settingGender',      s.gender);
      setSelect('settingVeteran',     s.veteranStatus);
      setSelect('settingDisability',  s.disabilityStatus);
      setSelect('settingHispanic',    s.hispanicLatino);
      setSelect('settingEthnicity',   s.ethnicity);
      setSelect('settingWorkAuth',    s.workAuthorization);
      setSelect('settingSponsorship', s.requireSponsorship);
      setSelect('settingCitizenship', s.citizenshipCountry);

      const quota = await DB.checkStorageQuota();
      const pct = quota.percent || 0;
      if (el('storageFill'))  el('storageFill').style.width = pct + '%';
      if (el('storageLabel')) el('storageLabel').textContent =
        `${pct}% used (${Math.round((quota.usage || 0) / 1024)} KB of ${Math.round((quota.quota || 10485760) / 1024)} KB)`;
      if (pct > 80 && el('storageFill')) el('storageFill').style.background = 'var(--danger)';
    } catch (e) {
      console.error('loadSettings error:', e);
    }
  }

  function setAiToggle(preferred) {
    document.querySelectorAll('.ai-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.ai === preferred);
    });
  }

  function getSelectText(id) {
    const el = document.getElementById(id);
    return el ? (el.options[el.selectedIndex]?.text || '') : '';
  }

  async function saveSettings() {
    try {
      await DB.saveSettings({
        autoDetect:         document.getElementById('settingAutoDetect')?.checked ?? true,
        showToastOnDetect:  document.getElementById('settingToast')?.checked      ?? true,
        autofillEnabled:    document.getElementById('settingAutofill')?.checked   ?? true,
        exportFormat:       'csv',
        preferredAI:        document.querySelector('.ai-toggle-btn.active')?.dataset.ai || 'chatgpt',
        aiPromptTemplate:   document.getElementById('settingAiPrompt')?.value || '',
        gender:             getSelectText('settingGender'),
        veteranStatus:      getSelectText('settingVeteran'),
        disabilityStatus:   getSelectText('settingDisability'),
        hispanicLatino:     getSelectText('settingHispanic'),
        ethnicity:          getSelectText('settingEthnicity'),
        workAuthorization:  getSelectText('settingWorkAuth'),
        requireSponsorship: getSelectText('settingSponsorship'),
        citizenshipCountry: getSelectText('settingCitizenship'),
      });
    } catch (e) { console.error('saveSettings error:', e); }
  }

  async function saveEeoSettings() {
    await saveSettings();
    const msg = document.getElementById('eeoSaveMsg');
    if (msg) { msg.style.display = 'inline'; setTimeout(() => { msg.style.display = 'none'; }, 2000); }
  }

  // ── Create application modal ──────────────────────────────────────────────
  function openCreateModal() {
    const existing = document.getElementById('createModalOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'createModalOverlay';
    overlay.className = 'modal-overlay';

    const platformOpts = Object.entries(PC)
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    const statusOpts = AS
      .map(s => `<option value="${s}"${s === 'Applied' ? ' selected' : ''}>${s}</option>`).join('');

    overlay.innerHTML = `
      <div class="modal-large" style="max-width:540px;max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header">
          <div><h2>Add Application</h2></div>
          <button class="modal-close" id="cClose">✕</button>
        </div>
        <div style="overflow-y:auto;flex:1;padding:20px 24px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group"><label>Job Title *</label><input id="cJobTitle" type="text" placeholder="Senior Engineer"></div>
            <div class="form-group"><label>Company *</label><input id="cCompany" type="text" placeholder="Acme Corp"></div>
            <div class="form-group"><label>Platform</label><select id="cPlatform">${platformOpts}</select></div>
            <div class="form-group"><label>Status</label><select id="cStatus">${statusOpts}</select></div>
            <div class="form-group" style="grid-column:1/-1"><label>Job URL</label><input id="cUrl" type="url" placeholder="https://..."></div>
            <div class="form-group"><label>Location</label><input id="cLocation" type="text" placeholder="Remote / New York, NY"></div>
            <div class="form-group"><label>Salary</label><input id="cSalary" type="text" placeholder="$100k–$120k"></div>
            <div class="form-group" style="grid-column:1/-1">
              <label>Notes</label>
              <textarea id="cNotes" rows="3" style="width:100%;background:var(--bg-base);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text-primary);font-family:inherit;resize:vertical;outline:none;font-size:13px"></textarea>
            </div>
            <div id="cError" style="display:none;grid-column:1/-1;color:var(--danger);font-size:12px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:6px;padding:8px"></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;padding:16px 24px;border-top:1px solid var(--border);flex-shrink:0">
          <button class="btn-secondary" id="cCancel" style="flex:1;justify-content:center">Cancel</button>
          <button class="btn-primary"   id="cSave"   style="flex:2;justify-content:center">Save Application</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.getElementById('cClose').addEventListener('click', close);
    document.getElementById('cCancel').addEventListener('click', close);

    document.getElementById('cSave').addEventListener('click', async () => {
      const jobTitle = document.getElementById('cJobTitle').value.trim();
      const company  = document.getElementById('cCompany').value.trim();
      const errEl    = document.getElementById('cError');
      if (!jobTitle || !company) {
        errEl.textContent = 'Job Title and Company are required.';
        errEl.style.display = 'block';
        return;
      }
      errEl.style.display = 'none';
      const btn = document.getElementById('cSave');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const status = document.getElementById('cStatus').value;
        const now = new Date().toISOString();
        await DB.addApplication({
          jobTitle, company,
          platform:       document.getElementById('cPlatform').value,
          status,
          applicationUrl: document.getElementById('cUrl').value.trim(),
          location:       document.getElementById('cLocation').value.trim(),
          salary:         document.getElementById('cSalary').value.trim(),
          notes:          document.getElementById('cNotes').value.trim(),
          dateFirstSeen:  now,
          dateApplied:    now,
          statusHistory:  [{ status, date: now, note: 'Added manually from dashboard' }],
          detectedAutomatically: false,
        });
        close();
        await loadApps();
      } catch (e) {
        errEl.textContent = 'Error: ' + e.message;
        errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Save Application';
      }
    });

    document.getElementById('cJobTitle').focus();
  }

  // ── Resume file handling ──────────────────────────────────────────────────
  async function handleResumeFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const errEl  = document.getElementById('resumeParseError');
    const loadEl = document.getElementById('resumeParseLoading');
    errEl.style.display = 'none';

    if (!['pdf', 'docx'].includes(ext)) {
      errEl.textContent = `Unsupported file type: .${ext}. Please upload a PDF or DOCX file.`;
      errEl.style.display = 'block';
      return;
    }
    if (!window.ResumeParser) {
      errEl.textContent = 'Resume parser not available. Please check your internet connection (pdf.js / mammoth.js required).';
      errEl.style.display = 'block';
      return;
    }

    loadEl.style.display = 'flex';
    try {
      parsedResume = await window.ResumeParser.parse(file);
      const existing = await DB.getResume();
      if (existing && (existing.email || existing.firstName)) {
        document.getElementById('resumeExistingBanner').style.display = 'flex';
      }
      populateResumeEditForm(parsedResume);
      showResumeState('edit');
    } catch (e) {
      errEl.textContent = 'Error parsing resume: ' + e.message;
      errEl.style.display = 'block';
    } finally {
      loadEl.style.display = 'none';
    }
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  function switchTab(targetName) {
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === targetName);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
      c.style.display = c.id === 'tab-' + targetName ? 'block' : 'none';
    });
    if (targetName === 'analytics') renderAnalytics();
  }

  // ── Analytics ───────────────────────────────────────────────────────────────
  function renderAnalytics() {
    const apps = allApps || [];
    const total = apps.length;
    const countBy = (fn) => apps.filter(fn).length;

    const applied = total; // every tracked record is a submitted application now
    const interviewStatuses = ['Phone Screen', 'Technical', 'Final Round'];
    const interviews = countBy(a => interviewStatuses.includes(a.status) || a.status === 'Offer');
    const offers   = countBy(a => a.status === 'Offer');
    const rejected = countBy(a => a.status === 'Rejected');

    const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) + '%' : '—';

    // Summary cards
    const cards = [
      { label: 'Total tracked', value: total },
      { label: 'Applied', value: applied },
      { label: 'Interview rate', value: pct(interviews, applied), hint: 'reached an interview stage' },
      { label: 'Offer rate', value: pct(offers, applied) },
      { label: 'Rejection rate', value: pct(rejected, applied) },
    ];
    document.getElementById('analyticsCards').innerHTML = cards.map(c => `
      <div class="analytics-card">
        <div class="analytics-card-value">${esc(String(c.value))}</div>
        <div class="analytics-card-label">${esc(c.label)}</div>
      </div>`).join('');

    // Funnel by status
    const statuses = (typeof AS !== 'undefined' && AS) ||
      ['Applied','Phone Screen','Technical','Final Round','Offer','Rejected','Ghosted','Withdrawn'];
    const counts = statuses.map(s => ({ s, n: countBy(a => a.status === s) }));
    const max = Math.max(1, ...counts.map(c => c.n));
    document.getElementById('analyticsFunnel').innerHTML = counts.map(c => `
      <div class="funnel-row">
        <div class="funnel-label">${esc(c.s)}</div>
        <div class="funnel-bar-track"><div class="funnel-bar" style="width:${Math.round((c.n / max) * 100)}%"></div></div>
        <div class="funnel-count">${c.n}</div>
      </div>`).join('');

    // Applications per week (last 8 weeks) based on dateFirstSeen/createdAt
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const buckets = new Array(8).fill(0);
    for (const a of apps) {
      const ts = new Date(a.dateFirstSeen || a.createdAt || 0).getTime();
      if (!ts) continue;
      const weeksAgo = Math.floor((now - ts) / WEEK);
      if (weeksAgo >= 0 && weeksAgo < 8) buckets[7 - weeksAgo]++;
    }
    const wMax = Math.max(1, ...buckets);
    document.getElementById('analyticsWeekly').innerHTML = buckets.map((n, i) => `
      <div class="weekly-col" title="${n} application(s)">
        <div class="weekly-bar" style="height:${Math.round((n / wMax) * 100)}%"></div>
        <div class="weekly-label">${i === 7 ? 'now' : (7 - i) + 'w'}</div>
        <div class="weekly-count">${n}</div>
      </div>`).join('');

    compileSalaryInsights();
  }

  // ── Event binding ─────────────────────────────────────────────────────────
  function bindEvents() {
    // Tab navigation
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // View toggle
    document.getElementById('viewKanban').addEventListener('click', () => {
      currentView = 'kanban';
      document.getElementById('viewKanban').classList.add('active');
      document.getElementById('viewTable').classList.remove('active');
      document.getElementById('kanbanBoard').style.display = 'flex';
      document.getElementById('tableView').style.display = 'none';
      renderKanban();
    });
    document.getElementById('viewTable').addEventListener('click', () => {
      currentView = 'table';
      document.getElementById('viewTable').classList.add('active');
      document.getElementById('viewKanban').classList.remove('active');
      document.getElementById('tableView').style.display = 'block';
      document.getElementById('kanbanBoard').style.display = 'none';
      renderTable();
    });

    // Filters
    document.getElementById('dashSearch').addEventListener('input', e => {
      clearTimeout(window._dashSearchTimer);
      window._dashSearchTimer = setTimeout(() => {
        activeFilters.search = e.target.value.trim();
        applyFilters();
      }, 220);
    });
    document.getElementById('filterStatus').addEventListener('change',   e => { activeFilters.status   = e.target.value; applyFilters(); });
    document.getElementById('filterPlatform').addEventListener('change', e => { activeFilters.platform = e.target.value; applyFilters(); });
    document.getElementById('filterDate').addEventListener('change',     e => { activeFilters.days     = e.target.value; applyFilters(); });

    // Table sort headers
    document.querySelectorAll('.app-table th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortCol = col; sortDir = 'asc'; }
        renderTable();
      });
    });

    // Nav action buttons
    document.getElementById('addAppBtn').addEventListener('click', openCreateModal);

    document.getElementById('exportBtn').addEventListener('click', async () => {
      try {
        const csv  = await DB.exportToCSV();
        const date = new Date().toISOString().slice(0, 10);
        dlFile(csv, `jobtrackr-export-${date}.csv`, 'text/csv;charset=utf-8;');
      } catch (e) { alert('Export failed: ' + e.message); }
    });

    document.getElementById('exportJsonBtn').addEventListener('click', async () => {
      try {
        const json = await DB.exportToJSON();
        const date = new Date().toISOString().slice(0, 10);
        dlFile(json, `jobtrackr-backup-${date}.json`, 'application/json;charset=utf-8;');
      } catch (e) { alert('Backup failed: ' + e.message); }
    });

    document.getElementById('importBtn').addEventListener('click', () => {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text   = await file.text();
        const isJson = /\.json$/i.test(file.name) || text.trim().startsWith('{') || text.trim().startsWith('[');
        const result = isJson
          ? await DB.importFromJSON(text, { restoreSettings: false, restoreResume: false })
          : await DB.importFromCSV(text);
        alert(`Import complete: ${result.imported} imported, ${result.skipped} skipped (duplicates).`);
        await loadApps();
      } catch (err) { alert('Import failed: ' + err.message); }
      e.target.value = '';
    });

    // Detail modal
    document.getElementById('detailClose').addEventListener('click', closeDetailModal);
    document.getElementById('detailModal').addEventListener('click', e => {
      if (e.target === e.currentTarget) closeDetailModal();
    });
    document.getElementById('detailSave').addEventListener('click', async () => {
      if (!currentDetailId) return;
      const status   = document.getElementById('detailStatusSelect').value;
      const notes    = document.getElementById('detailNotes').value.trim();
      const jobTitle = document.getElementById('detailTitle').value.trim();
      const company  = document.getElementById('detailCompany').value.trim();
      await DB.updateApplicationStatus(currentDetailId, status, 'Status changed from dashboard');
      await DB.updateApplication(currentDetailId, { notes, jobTitle, company });
      closeDetailModal();
      await loadApps();
    });
    document.getElementById('detailDelete').addEventListener('click', async () => {
      if (!currentDetailId) return;
      if (confirm('Delete this application permanently?')) {
        await DB.deleteApplication(currentDetailId);
        closeDetailModal();
        await loadApps();
      }
    });

    // Resume upload
    const fileInput = document.getElementById('resumeFileInput');
    document.getElementById('resumePickFile').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async e => {
      if (e.target.files[0]) await handleResumeFile(e.target.files[0]);
      e.target.value = '';
    });

    const uploadArea = document.getElementById('resumeUploadArea');
    uploadArea.addEventListener('dragover',  e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
    uploadArea.addEventListener('drop', async e => {
      e.preventDefault(); uploadArea.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) await handleResumeFile(e.dataTransfer.files[0]);
    });

    // Resume form
    document.getElementById('skillAddInput').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const val = e.target.value.trim();
      if (val && !currentSkills.includes(val)) { currentSkills.push(val); renderSkillTags(currentSkills); }
      e.target.value = '';
    });

    document.getElementById('addExpBtn').addEventListener('click', () => {
      experienceEntries.push({ company: '', role: '', startDate: '', endDate: '', description: '' });
      renderExperience(experienceEntries);
    });
    document.getElementById('addEduBtn').addEventListener('click', () => {
      educationEntries.push({ institution: '', degree: '', field: '', startDate: '', endDate: '' });
      renderEducation(educationEntries);
    });
    document.getElementById('addCertBtn').addEventListener('click', () => {
      certEntries.push('');
      renderCerts(certEntries);
    });

    document.getElementById('resumeSaveBtn').addEventListener('click', async () => {
      const data = collectResumeData();
      await DB.saveResume(data);
      const saved = { ...data, lastUpdated: new Date().toISOString() };
      showResumeState('saved');
      renderSavedResume(saved);
      document.getElementById('resumeExistingBanner').style.display = 'none';
    });
    document.getElementById('resumeCancelBtn').addEventListener('click', async () => {
      const saved = await DB.getResume();
      if (saved && (saved.email || saved.firstName)) { showResumeState('saved'); renderSavedResume(saved); }
      else showResumeState('upload');
      document.getElementById('resumeExistingBanner').style.display = 'none';
    });
    document.getElementById('editResumeBtn').addEventListener('click', async () => {
      const saved = await DB.getResume();
      if (saved) { parsedResume = saved; populateResumeEditForm(saved); showResumeState('edit'); }
    });
    document.getElementById('uploadNewResumeBtn').addEventListener('click', () => showResumeState('upload'));

    // Settings — toggles auto-save
    ['settingAutoDetect', 'settingToast', 'settingAutofill'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', saveSettings);
    });
    // EEO save button
    document.getElementById('saveEeoBtn')?.addEventListener('click', saveEeoSettings);

    // AI toggle buttons
    document.getElementById('aiToggleGroup')?.addEventListener('click', e => {
      const btn = e.target.closest('.ai-toggle-btn');
      if (!btn) return;
      setAiToggle(btn.dataset.ai);
    });

    // AI save / reset
    document.getElementById('saveAiSettingsBtn')?.addEventListener('click', async () => {
      await saveSettings();
      const msg = document.getElementById('aiSaveMsg');
      if (msg) { msg.style.display = 'inline'; setTimeout(() => { msg.style.display = 'none'; }, 2000); }
    });
    document.getElementById('resetAiPromptBtn')?.addEventListener('click', () => {
      const el = document.getElementById('settingAiPrompt');
      if (el) el.value = DB.DEFAULT_AI_PROMPT || '';
    });
    document.getElementById('clearAllBtn').addEventListener('click', async () => {
      if (confirm('Permanently delete ALL application records?')) {
        await chrome.storage.local.set({ jobtrackr_applications: [] });
        await loadApps();
      }
    });

    // Salary & Offer Negotiation Helper
    document.getElementById('negoAnalyzeBtn')?.addEventListener('click', handleNegoAnalysis);
    document.getElementById('negoCopyBtn')?.addEventListener('click', () => {
      const txt = document.getElementById('negoScriptText');
      if (txt) {
        txt.select();
        document.execCommand('copy');
        const copyBtn = document.getElementById('negoCopyBtn');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      }
    });

    // Outreach Templates
    document.getElementById('outreachFollowupBtn')?.addEventListener('click', () => generateOutreachTemplate('followup'));
    document.getElementById('outreachThankyouBtn')?.addEventListener('click', () => generateOutreachTemplate('thankyou'));
    document.getElementById('outreachConnectBtn')?.addEventListener('click', () => generateOutreachTemplate('connect'));
    document.getElementById('outreachCopyBtn')?.addEventListener('click', () => {
      const txt = document.getElementById('outreachText');
      if (txt) {
        txt.select();
        document.execCommand('copy');
        const copyBtn = document.getElementById('outreachCopyBtn');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      }
    });

    // Interview Prep
    document.getElementById('prepOpenAiBtn')?.addEventListener('click', handlePrepOpenAi);

    // Archived Workspace Toggles
    document.getElementById('filterArchived')?.addEventListener('change', e => {
      showArchived = e.target.checked;
      applyFilters();
    });

    document.getElementById('detailArchive')?.addEventListener('click', async () => {
      if (!currentDetailId) return;
      const app = allApps.find(a => a.id === currentDetailId);
      if (!app) return;
      const newArchived = !app.archived;
      await DB.updateApplication(currentDetailId, { archived: newArchived });
      closeDetailModal();
      await loadApps();
    });
  }

  // ── Salary offering & Negotiation helper functions ─────────────────────────
  function parseSalaryValue(str) {
    if (!str) return null;
    const cleaned = str.toLowerCase().replace(/,/g, '');
    const matches = cleaned.match(/(\d+)\s*(k)?/g);
    if (!matches) return null;
    
    const parsedNumbers = matches.map(m => {
      const numMatch = m.match(/(\d+)/);
      if (!numMatch) return 0;
      let val = parseInt(numMatch[1], 10);
      if (m.includes('k')) {
        val *= 1000;
      }
      return val;
    }).filter(n => n > 20000);

    if (parsedNumbers.length === 0) return null;
    
    return {
      min: Math.min(...parsedNumbers),
      max: Math.max(...parsedNumbers),
      avg: Math.round(parsedNumbers.reduce((a, b) => a + b, 0) / parsedNumbers.length)
    };
  }

  function compileSalaryInsights() {
    const apps = allApps || [];
    const minValues = [];
    const maxValues = [];
    const avgValues = [];
    
    const selectEl = document.getElementById('negoAppSelect');
    if (!selectEl) return;
    
    selectEl.innerHTML = '<option value="">Choose an application…</option>';
    
    apps.forEach(app => {
      if (app.jobTitle && app.company) {
        const salaryStr = app.salary ? ` (${app.salary})` : '';
        const opt = document.createElement('option');
        opt.value = app.id;
        opt.textContent = `${app.company} — ${app.jobTitle}${salaryStr}`;
        selectEl.appendChild(opt);
      }
      
      if (app.salary) {
        const parsed = parseSalaryValue(app.salary);
        if (parsed) {
          minValues.push(parsed.min);
          maxValues.push(parsed.max);
          avgValues.push(parsed.avg);
        }
      }
    });
    
    const minValEl = document.getElementById('salaryMinVal');
    const avgValEl = document.getElementById('salaryAvgVal');
    const maxValEl = document.getElementById('salaryMaxVal');
    
    const formatCurrency = (val) => {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
    };
    
    if (avgValues.length > 0) {
      const minVal = Math.min(...minValues);
      const maxVal = Math.max(...maxValues);
      const avgVal = Math.round(avgValues.reduce((a, b) => a + b, 0) / avgValues.length);
      
      minValEl.textContent = formatCurrency(minVal);
      avgValEl.textContent = formatCurrency(avgVal);
      maxValEl.textContent = formatCurrency(maxVal);
    } else {
      minValEl.textContent = '—';
      avgValEl.textContent = '—';
      maxValEl.textContent = '—';
    }
  }

  function handleNegoAnalysis() {
    const appId = document.getElementById('negoAppSelect').value;
    const offerSalaryVal = parseInt(document.getElementById('negoOfferSalary').value, 10);
    const offerSignon = parseInt(document.getElementById('negoOfferSignon').value, 10) || 0;
    const offerEquity = document.getElementById('negoOfferEquity').value.trim() || '';
    
    const resultArea = document.getElementById('negoResultArea');
    const summaryText = document.getElementById('negoSummaryText');
    const scriptText = document.getElementById('negoScriptText');
    
    if (!appId || isNaN(offerSalaryVal)) {
      alert('Please select an application and input the offered base salary.');
      return;
    }
    
    const app = allApps.find(a => a.id === appId);
    if (!app) return;
    
    resultArea.style.display = 'block';
    
    let targetMin = null;
    let targetMax = null;
    let targetAvg = null;
    
    if (app.salary) {
      const parsed = parseSalaryValue(app.salary);
      if (parsed) {
        targetMin = parsed.min;
        targetMax = parsed.max;
        targetAvg = parsed.avg;
      }
    }
    
    const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
    
    let summaryHtml = '';
    let emailScript = '';
    
    const candidateName = [parsedResume?.firstName, parsedResume?.lastName].filter(Boolean).join(' ') || '[Your Name]';
    
    if (targetMin && targetMax) {
      const isBelowMin = offerSalaryVal < targetMin;
      const isAboveMax = offerSalaryVal > targetMax;
      
      if (isBelowMin) {
        const diff = targetMin - offerSalaryVal;
        summaryHtml = `<strong>⚠️ Below Target Range:</strong> The offered salary of <strong>${formatCurrency(offerSalaryVal)}</strong> is below the listing target range of <strong>${app.salary}</strong> (difference of <strong>${formatCurrency(diff)}</strong>). We suggest countering to request matching the range.`;
        
        emailScript = `Subject: Response to Offer - ${app.jobTitle} - ${candidateName}

Dear Recruiting Team,

Thank you very much for offering me the opportunity to join ${app.company} as a ${app.jobTitle}. I am incredibly excited about the team and the goals we discussed during my interviews.

Before signing, I wanted to discuss the compensation package. The original posting listed a base salary starting at ${formatCurrency(targetMin)}. Given my technical background and skills, I would like to request aligning the base salary to ${formatCurrency(Math.round(targetMin + (targetMax - targetMin) * 0.25))} to match the target range of the position.

I hope we can align on this, and I look forward to your thoughts.

Best regards,
${candidateName}`;
      } else if (isAboveMax) {
        summaryHtml = `<strong>🎉 Strong Offer:</strong> The offered salary of <strong>${formatCurrency(offerSalaryVal)}</strong> is above the listed range of <strong>${app.salary}</strong>. Negotiation should focus on sign-on bonuses, equity, or additional benefits.`;
        
        emailScript = `Subject: Response to Offer - ${app.jobTitle} - ${candidateName}

Dear Recruiting Team,

Thank you so much for the offer to join ${app.company} as a ${app.jobTitle}. I am thrilled to receive this and look forward to contributing to the team's success.

I am very happy with the base salary of ${formatCurrency(offerSalaryVal)}. To finalize the agreement, I wanted to see if there is any flexibility regarding the sign-on bonus or equity package. An adjustment of ${offerSignon > 0 ? formatCurrency(offerSignon + 5000) : '$5,000'} in the sign-on bonus or additional RSUs would make this an immediate and easy decision.

Thank you again for your time and guidance throughout the process.

Best regards,
${candidateName}`;
      } else {
        const rangePct = Math.round(((offerSalaryVal - targetMin) / (targetMax - targetMin)) * 100);
        summaryHtml = `<strong>📊 Market Value Offer:</strong> The offered salary of <strong>${formatCurrency(offerSalaryVal)}</strong> is within the listed range of <strong>${app.salary}</strong> (at the <strong>${rangePct}%</strong> mark of the range). You can politely counter for a slight adjustment or focus on a sign-on bonus to bridge any gap.`;
        
        emailScript = `Subject: Response to Offer - ${app.jobTitle} - ${candidateName}

Dear Recruiting Team,

Thank you very much for extending the offer to join ${app.company} as a ${app.jobTitle}. I have really enjoyed getting to know the team.

The base salary offer of ${formatCurrency(offerSalaryVal)} is within the target range. However, given my experience and target expectations, I would like to ask if we could adjust the base to ${formatCurrency(Math.min(targetMax, Math.round(offerSalaryVal * 1.07)))} to bring it closer to the top end of the range. Alternatively, if there is flexibility for a sign-on bonus of ${formatCurrency(Math.round(offerSalaryVal * 0.08))} to bridge the difference, I would be happy to sign immediately.

Thank you for your consideration, and I look forward to working together.

Best regards,
${candidateName}`;
      }
    } else {
      summaryHtml = `<strong>ℹ️ No Target Salary Listed:</strong> No target salary range was captured for this job. We will generate a standard, polite negotiation counter-offer script requesting a 10% increase.`;
      
      emailScript = `Subject: Response to Offer - ${app.jobTitle} - ${candidateName}

Dear Recruiting Team,

Thank you so much for extending the offer to join ${app.company} as a ${app.jobTitle}. I am very excited about the opportunity.

I would like to review the base salary component of the package. Based on my expectations and market averages for similar roles, I wanted to see if we could adjust the base salary to ${formatCurrency(Math.round(offerSalaryVal * 1.08))} before moving forward.

I appreciate your consideration and hope we can align on this.

Best regards,
${candidateName}`;
    }
    
    summaryText.innerHTML = summaryHtml;
    scriptText.value = emailScript;
  }

  // ── Outreach & Interview Prep Helpers ──────────────────────────────────────
  function generateOutreachTemplate(type) {
    if (!currentDetailId) return;
    const app = allApps.find(a => a.id === currentDetailId);
    if (!app) return;

    const company = app.company || '[Company]';
    const title = app.jobTitle || '[Job Title]';
    const candidateName = [parsedResume?.firstName, parsedResume?.lastName].filter(Boolean).join(' ') || '[Your Name]';

    const resultBox = document.getElementById('outreachResultBox');
    const outreachText = document.getElementById('outreachText');
    if (!resultBox || !outreachText) return;

    let text = '';
    if (type === 'followup') {
      text = `Subject: Application Follow-Up: ${title} - ${candidateName}

Dear Recruiting Team,

I hope you are having a great week. 

I am writing to check in on the status of my application for the ${title} position at ${company}. I am very excited about the opportunity to join the team and contribute to your goals. 

Please let me know if you need any additional materials, references, or details from my end. Thank you so much for your time and consideration.

Best regards,
${candidateName}`;
    } else if (type === 'thankyou') {
      text = `Subject: Thank You - ${title} Interview - ${candidateName}

Dear Interview Team,

Thank you very much for taking the time to speak with me today regarding the ${title} position at ${company}. 

I really enjoyed learning more about the team's upcoming challenges and the exciting work you are doing. Our conversation confirmed my enthusiasm for the role and my confidence that my skills align well with the team's needs.

I look forward to hearing about the next steps. Please let me know if I can provide any further information in the meantime.

Best regards,
${candidateName}`;
    } else if (type === 'connect') {
      text = `Hi [Recruiter Name], I recently applied for the ${title} position at ${company}. Given my background, I'm very excited about the team's work and would love to connect to learn more about the role and how I can add value. Best, ${candidateName}`;
    }

    outreachText.value = text;
    resultBox.style.display = 'block';

    const copyBtn = document.getElementById('outreachCopyBtn');
    if (copyBtn) copyBtn.textContent = 'Copy';
  }

  function renderInterviewPrep(app) {
    const sheet = document.getElementById('detailPrepSheet');
    if (!sheet) return;

    const jd = app.jobDescription || '';
    if (!jd || jd.length < 50) {
      sheet.style.display = 'none';
      return;
    }

    sheet.style.display = 'block';
  }

  async function handlePrepOpenAi() {
    if (!currentDetailId) return;
    const app = allApps.find(a => a.id === currentDetailId);
    if (!app) return;

    const btn = document.getElementById('prepOpenAiBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Opening AI Chat…';
    }

    try {
      const settings = await DB.getSettings();
      const company = app.company || 'the company';
      const title = app.jobTitle || 'the position';
      const jd = app.jobDescription || '';
      
      const resumeText = parsedResume ? JSON.stringify({
        summary: parsedResume.summary,
        skills: parsedResume.skills,
        experience: (parsedResume.experience || []).map(e => ({ role: e.role, company: e.company, desc: e.description }))
      }) : 'No resume saved.';

      const prompt = `Act as an expert technical interviewer. I am preparing for an interview for the role of "${title}" at "${company}".

Here is the Job Description:
${jd}

Here is my background/resume info:
${resumeText}

Please generate a highly targeted Interview Prep Guide & Cheat Sheet containing:
1. Top 5 technical concepts/skills I am likely to be tested on, with brief explanations.
2. 3 potential coding/system design questions based on the JD.
3. 3 behavioral questions (STAR method) customized to align my experience with this JD.
4. Tips for standing out in this interview.`;

      const aiUrl = settings.preferredAI === 'gemini' ? 'https://gemini.google.com/app' : 'https://chatgpt.com/';
      await chrome.runtime.sendMessage({ type: 'OPEN_AI_CHAT', aiUrl, prompt });

      if (btn) {
        btn.textContent = '✓ Opened!';
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = 'Open Prep Guide in AI Chat';
        }, 2000);
      }
    } catch (e) {
      console.error('handlePrepOpenAi error', e);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Error opening AI chat';
        setTimeout(() => {
          btn.textContent = 'Open Prep Guide in AI Chat';
        }, 2000);
      }
    }
  }

  // ── Utility ───────────────────────────────────────────────────────────────
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  // Scripts are at end of <body>, DOM is already parsed — call init directly.
  // Guard with readyState in case of any edge-case extension page behaviour.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }

})(); // end IIFE
