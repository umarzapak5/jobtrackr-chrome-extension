# JobTrackr — Chrome Extension

A Manifest V3 Chrome Extension for automatically tracking job applications and auto-filling forms using a parsed resume. Fully client-side — no external server, no accounts required.

---

## Architecture Overview

All data lives in `chrome.storage.local`. The extension has three major components:

1. **Content Scripts** — injected into every page, detect job applications (Phase 1 / Phase 2) and provide form auto-fill
2. **Background Service Worker** — handles messages from content scripts, manages storage writes
3. **Popup + Dashboard** — vanilla HTML/CSS/JS UI for viewing, managing, and exporting applications

No build tools. No frameworks. All files load directly in Chrome.

---

## File Responsibilities

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest — permissions, content scripts, service worker, popup |
| `background/service-worker.js` | Message handler; Phase 1 / Phase 2 storage logic |
| `content/detector.js` | Per-page job detection; Phase 1 (Pending) and Phase 2 (Applied) signals; toast notifications |
| `content/autofill.js` | Detects job application forms; injects Auto-Fill button; fills fields from saved resume |
| `popup/popup.html/css/js` | 400×560 extension popup: stats, search, application list, quick status edit, manual entry modal |
| `dashboard/dashboard.html/css/js` | Full-page dashboard: Kanban board (drag-and-drop), table view, detail modal, import/export |
| `resume/resume-parser.js` | Client-side PDF (pdf.js) and DOCX (mammoth.js) parsing; field extraction pipeline |
| `storage/db.js` | All `chrome.storage.local` CRUD helpers; duplicate detection; CSV export/import |
| `utils/helpers.js` | Shared utilities: time formatting, status/platform config, badge generators, debounce |
| `icons/` | Extension icons at 16px, 48px, 128px |

---

## Loading the Extension in Chrome (Unpacked)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **"Load unpacked"**
4. Select the `jobtrackr/` folder (the one containing `manifest.json`)
5. The JobTrackr icon will appear in your toolbar. Pin it if desired.

To reload after making code changes: click the refresh icon on the extension card at `chrome://extensions/`.

---

## How to Test Each Feature

### Feature 1 — Phase 1 Detection (Pending)

1. Ensure JobTrackr is loaded and enabled
2. Navigate to any LinkedIn job listing: `https://www.linkedin.com/jobs/view/...`
3. Within 1–2 seconds, a toast appears at bottom-right:
   > "👁 JobTrackr is tracking this job — [Title] at [Company]. Status: Pending."
4. Open the popup → the job appears with an **orange "Pending"** badge

### Feature 2 — Phase 2 Detection (Applied)

1. On LinkedIn, click "Easy Apply" and complete an application
2. When the "Application submitted" confirmation modal appears, watch for the toast:
   > "✅ Application confirmed — [Title] at [Company]. Status updated to Applied!"
3. Open the popup → the same record now shows a **gray "Applied"** badge with today's date

### Feature 3 — Resume Upload (PDF)

1. Open the dashboard: click the JobTrackr icon → "Open Full Dashboard"
2. Click the **Resume** tab
3. Click "Choose File" and select a PDF resume
4. The parser will extract text client-side and display the **Review & Edit** form
5. Verify fields are populated, make corrections, click **"Save Resume"**

### Feature 4 — Resume Upload (DOCX)

Same as PDF but upload a `.docx` file. Mammoth.js handles extraction.

### Feature 5 — Form Auto-Fill

1. Make sure a resume is saved (see Feature 3)
2. Navigate to a job application page that has a form (e.g., Greenhouse, Lever, or any page with multiple inputs)
3. A floating blue **"Auto-Fill Form"** button appears at bottom-right
4. Click it — fields matching your resume are filled and briefly highlighted in green
5. A count toast appears: "✅ Filled X/Y fields. Please review before submitting."

### Feature 6 — CSV Export

1. In the dashboard, click **"Export CSV"** in the nav bar
2. A `.csv` file downloads with all application data

### Feature 7 — CSV Import

1. Click **"Import"** in the nav bar
2. Select a CSV file matching the export format
3. Duplicates are skipped; new records are added

---

## Storage Key Reference

| Key | Contents |
|-----|----------|
| `jobtrackr_applications` | Array of application records |
| `jobtrackr_resume` | Parsed resume object |
| `jobtrackr_settings` | User settings (autoDetect, toast, autofill, exportFormat) |

### Application Record Schema

```js
{
  id: "uuid-v4",
  jobTitle: "",
  company: "",
  platform: "",           // "linkedin" | "indeed" | "greenhouse" | etc.
  applicationUrl: "",
  location: "",
  jobType: "",
  salary: "",
  dateFirstSeen: "",      // ISO — when Phase 1 fired
  dateApplied: "",        // ISO — when Phase 2 confirmed (null until then)
  status: "Pending",      // see statuses below
  statusHistory: [],
  jobDescription: "",     // full JD text, no truncation
  notes: "",
  detectedAutomatically: true,
  createdAt: "",
  updatedAt: ""
}
```

### Statuses

`Pending` → `Applied` → `Phone Screen` → `Technical` → `Final Round` → `Offer` | `Rejected` | `Ghosted` | `Withdrawn`

---

## Known Limitations

- **LinkedIn SPA routing**: LinkedIn is a heavy SPA; Phase 2 detection uses MutationObserver to catch dynamically injected confirmation modals, but if LinkedIn changes their DOM structure, selectors may need updating
- **Storage quota**: `chrome.storage.local` has a 10 MB limit. With full JDs stored, ~500–1000 applications will fill it. A warning appears at 80% capacity
- **PDF parsing accuracy**: Complex multi-column or heavily formatted PDFs may not parse cleanly — always review the extracted fields before saving
- **DOCX images**: Mammoth.js extracts raw text only; embedded images in resumes are not captured
- **Auto-fill on React/Angular/Vue forms**: The autofill uses native input value setters and dispatches `input`/`change`/`blur` events, which works for most frameworks. Some custom components may require manual entry
- **Workday**: Workday applications often load in iframes; content script injection into cross-origin iframes requires additional permissions not requested by this extension

## Future Enhancement Ideas

- AI-powered JD matching against saved resume (highlight skill gaps)
- Google Sheets sync for team/shared tracking
- Application deadline reminders via Chrome alarms
- Browser action badge showing count of pending applications
- Screenshot capture of confirmation pages
- Interview prep notes with calendar integration
- Rejection/offer rate analytics dashboard
