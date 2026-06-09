// JobTrackr Resume Parser — client-side PDF/DOCX parsing

const ResumeParser = (() => {

  // ── Text cleaning ──────────────────────────────────────────────────────────
  function cleanText(raw) {
    if (!raw) return '';
    return raw
      .replace(/[''‚‛]/g, "'")
      .replace(/[""„‟]/g, '"')
      .replace(/[–—―]/g, '-')
      .replace(/[•‣⁃◦∙·]/g, '•')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n').map(l => l.trim()).join('\n')
      .trim();
  }

  function trim(val) {
    return val ? val.replace(/\s+/g, ' ').trim() : '';
  }

  // ── Contact info extraction ────────────────────────────────────────────────
  function extractEmail(text) {
    const m = text.match(/[\w.+\-]+@[\w\-]+\.[a-z]{2,}/i);
    return m ? m[0].toLowerCase() : '';
  }

  function extractPhone(text) {
    const m = text.match(/(\+?1[\s.\-]?)?(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/);
    if (!m) return '';
    return m[0].trim();
  }

  function extractLinkedIn(text) {
    const m = text.match(/linkedin\.com\/in\/[\w\-]+/i);
    return m ? 'https://' + m[0] : '';
  }

  function extractGitHub(text) {
    const m = text.match(/github\.com\/[\w\-]+/i);
    return m ? 'https://' + m[0] : '';
  }

  function extractPortfolio(text) {
    const lines = text.split('\n');
    for (const line of lines.slice(0, 10)) {
      const lower = line.toLowerCase();
      if (/portfolio|personal site|website/.test(lower)) {
        const m = line.match(/https?:\/\/[^\s"'<>]+|(?:www\.)?[\w\-]+\.(?:com|io|net|co)[^\s"'<>]*/i);
        if (m) return m[0].startsWith('http') ? m[0] : 'https://' + m[0];
      }
    }
    return '';
  }

  // ── Name extraction ────────────────────────────────────────────────────────
  function extractName(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines.slice(0, 4)) {
      if (line.includes('@') || /\d{3}.*\d{4}/.test(line) || line.startsWith('http')) continue;
      // Skip lines that look like titles/subtitles (contain bullets, pipes, dots between words)
      if (/[•|]/.test(line) && line.length > 40) continue;
      // Skip very long lines (likely summaries)
      if (line.length > 60) continue;
      const words = line.split(/\s+/).filter(w => /^[A-Za-z\-'.]+$/.test(w));
      if (words.length >= 2 && words.length <= 5) {
        return {
          firstName: trim(words[0]),
          lastName: trim(words.slice(1).join(' ')),
        };
      }
    }
    return { firstName: '', lastName: '' };
  }

  // ── Current title extraction ───────────────────────────────────────────────
  function extractCurrentTitle(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines.slice(1, 8)) {
      if (line.includes('@') || /\d{3}.*\d{4}/.test(line) || line.startsWith('http')) continue;
      if (line.length < 5 || line.length > 120) continue;
      // Line with bullet separators like "Lead • Engineer • Domain" — take first segment
      if (/•/.test(line)) {
        return trim(line.split('•')[0]);
      }
      // Regular title line
      if (/engineer|developer|manager|analyst|designer|consultant|director|lead|senior|junior|associate|specialist|architect|programmer/i.test(line)) {
        return trim(line);
      }
    }
    return '';
  }

  // ── Address ────────────────────────────────────────────────────────────────
  function extractAddress(text) {
    const address = { city: '', state: '', zip: '', country: '' };
    // Pattern: "City, ST" or "City, ST Zip"
    const m = text.match(/([A-Za-z\s]+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?/);
    if (m) {
      address.city = trim(m[1]);
      address.state = trim(m[2]);
      address.zip = trim(m[3] || '');
    }
    return address;
  }

  // ── Section finder ─────────────────────────────────────────────────────────
  // Finds text between a heading and the next ALL-CAPS heading
  function findSection(text, headings) {
    const escaped = headings.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    // Headings in this resume style are ALL CAPS on their own line
    const re = new RegExp(
      `(?:^|\\n)[ \\t]*(?:${escaped})[ \\t]*\\n(.*?)(?=\\n[ \\t]*[A-Z][A-Z &\\/(),.+\\-]{3,}[ \\t]*\\n|$)`,
      'is'
    );
    const m = text.match(re);
    return m ? m[1].trim() : '';
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  function extractSummary(text) {
    const content = findSection(text, [
      'PROFESSIONAL SUMMARY', 'SUMMARY', 'PROFILE', 'ABOUT ME',
      'OBJECTIVE', 'CAREER OBJECTIVE', 'EXECUTIVE SUMMARY',
      'Professional Summary', 'Summary', 'Profile', 'About Me',
    ]);
    return content.replace(/\n+/g, ' ').trim();
  }

  // ── Skills ─────────────────────────────────────────────────────────────────
  function extractSkills(text) {
    const content = findSection(text, [
      'CORE TECHNICAL SKILLS', 'TECHNICAL SKILLS', 'SKILLS', 'CORE COMPETENCIES',
      'TECHNOLOGIES', 'TECH STACK', 'TOOLS', 'KEY SKILLS', 'COMPETENCIES',
      'Core Technical Skills', 'Technical Skills', 'Skills', 'Core Competencies',
    ]);
    if (!content) return [];

    // Strip category-label prefixes like "Application Development: " before the skill list
    // Each category is "Label: skills, skills" — extract only the skills part
    let skillsText = content;

    // Replace "Category Name: " with a newline so the rest parses as skills
    skillsText = skillsText.replace(/^[A-Z][A-Za-z &\/()]+:\s*/gm, '\n');

    const raw = skillsText.replace(/^[-•*]\s*/gm, '');
    const all = raw
      .split(/[,|•\n\/]+/)
      .map(s => trim(s))
      .filter(s => s.length > 0 && s.length < 60 && !/^\d+$/.test(s));

    const seen = new Set();
    return all.filter(s => {
      const key = s.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Date range parsing (handles full and abbreviated month names) ──────────
  function parseDateRange(text) {
    // Full month names + abbreviations, optional dot, optional space, then year
    const MONTH = '[A-Za-z]{3,9}\\.?';
    const YEAR  = '\\d{4}';
    const DATE  = `(?:${MONTH}\\s*)?${YEAR}`;
    const END   = `(?:${DATE}|Present|Current|Now)`;
    const re = new RegExp(`(${DATE})\\s*[-–—to]+\\s*(${END})`, 'i');
    const m = text.match(re);
    if (m) {
      return { startDate: trim(m[1]), endDate: trim(m[2]) };
    }
    // Single year fallback
    const yearM = text.match(/\d{4}/);
    if (yearM) return { startDate: yearM[0], endDate: '' };
    return { startDate: '', endDate: '' };
  }

  // ── Experience ─────────────────────────────────────────────────────────────
  function extractExperience(text) {
    const content = findSection(text, [
      'PROFESSIONAL EXPERIENCE', 'EXPERIENCE', 'WORK EXPERIENCE',
      'EMPLOYMENT', 'WORK HISTORY', 'CAREER HISTORY',
      'Professional Experience', 'Experience', 'Work Experience',
    ]);
    if (!content) return [];

    const entries = [];
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

    let current = null;
    let descLines = [];

    function saveEntry() {
      if (!current) return;
      current.description = descLines
        .map(l => l.replace(/^[-•*]\s*/, ''))
        .join('\n')
        .trim();
      entries.push(current);
    }

    for (const line of lines) {
      const dr = parseDateRange(line);

      // Detect a new job entry: line has a date range AND looks like a header
      // Header indicators: contains | or at/@ separator, or starts with a title word
      const hasDateRange = !!dr.startDate && dr.endDate !== undefined;
      const isShortish = line.length < 140;
      const hasPipe = line.includes(' | ');
      const hasTitleWord = /engineer|developer|manager|analyst|designer|consultant|director|lead|senior|junior|associate|specialist|architect|programmer/i.test(line);

      if (hasDateRange && isShortish && (hasPipe || hasTitleWord)) {
        saveEntry();
        descLines = [];

        // Strip the date portion from the line to get role/company
        const withoutDate = line
          .replace(/([A-Za-z]{3,9}\.?\s*)?\d{4}\s*[-–—to]+\s*(?:[A-Za-z]{3,9}\.?\s*)?\d{4}/gi, '')
          .replace(/([A-Za-z]{3,9}\.?\s*)?\d{4}\s*[-–—to]+\s*(?:Present|Current|Now)/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim();

        let role = '', company = '';
        if (hasPipe) {
          const [left, right] = withoutDate.split(' | ').map(s => trim(s));
          role = left || '';
          // Company may have a client sub-label like "NTT Data Americas"
          company = right ? right.replace(/\s*\(.*?\)\s*/g, '').trim() : '';
        } else {
          const parts = withoutDate.split(/ at | @ | [-–] /);
          role = trim(parts[0] || '');
          company = trim(parts[1] || '');
        }

        current = { role, company, startDate: dr.startDate, endDate: dr.endDate, description: '' };
      } else if (current) {
        // Skip "Technologies: ..." summary lines — they're tech stacks not bullet points
        if (/^Technologies:/i.test(line)) continue;
        // Skip "Client: ..." sub-headers
        if (/^Client:/i.test(line)) continue;
        descLines.push(line);
      }
    }
    saveEntry();
    return entries;
  }

  // ── Education ──────────────────────────────────────────────────────────────
  function extractEducation(text) {
    const content = findSection(text, [
      'EDUCATION', 'ACADEMIC BACKGROUND', 'ACADEMIC HISTORY', 'EDUCATIONAL BACKGROUND',
      'Education', 'Academic Background',
    ]);
    if (!content) return [];

    const entries = [];
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

    // Degree keywords — extended to cover M.S., M.C.S., B.S., Bachelor's, etc.
    const DEGREE_RE = /bachelor|master|phd|doctorate|associate|b\.s|m\.s|b\.a|m\.a|mba|m\.c\.s|mscs|graduate/i;

    for (const line of lines) {
      const dr = parseDateRange(line);
      if (!DEGREE_RE.test(line) && !dr.startDate) continue;

      // Strip year from line
      const withoutYear = line.replace(/\s*\d{4}\s*$/, '').trim();

      // Split on ' - ' or ' – ' to separate degree from institution
      const parts = withoutYear.split(/\s*[-–]\s*/);

      let degree = '', institution = '', field = '';

      if (parts.length >= 2) {
        // First part is likely degree, rest is institution
        degree = trim(parts[0]);
        institution = trim(parts.slice(1).join(' - '));
      } else {
        // Single chunk — try to extract degree keyword
        const degM = withoutYear.match(/((?:Bachelor|Master|PhD|Doctorate|Associate|M\.S\.|B\.S\.|M\.A\.|B\.A\.|MBA|M\.C\.S\.|MSCS)[^\n,]*)/i);
        if (degM) degree = trim(degM[0]);
      }

      // Extract field from "in Computer Science" or "of Science"
      const fieldM = degree.match(/\bin\s+([A-Za-z\s]+?)(?:\s*\(|,|$)/i);
      if (fieldM) {
        field = trim(fieldM[1]);
        degree = trim(degree.replace(fieldM[0], ''));
      }

      // Remove city/state/country from institution to keep it clean
      // Institution ends before the comma+state pattern
      const instClean = institution.replace(/,\s*[A-Za-z\s]+,\s*[A-Z]{2,}.*$/, '').trim();

      entries.push({
        institution: instClean || institution,
        degree: degree,
        field: field,
        startDate: '',
        endDate: dr.startDate || '',
      });
    }

    return entries;
  }

  // ── Certifications ─────────────────────────────────────────────────────────
  function extractCertifications(text) {
    const content = findSection(text, [
      'CERTIFICATIONS & PROFESSIONAL DEVELOPMENT', 'CERTIFICATIONS', 'CERTIFICATES',
      'LICENSES', 'PROFESSIONAL CERTIFICATIONS', 'PROFESSIONAL DEVELOPMENT',
      'Certifications', 'Certificates',
    ]);
    if (!content) return [];
    return content.split('\n')
      .map(l => l.replace(/^[-•*]\s*/, '').trim())
      .filter(l => l.length > 2);
  }

  // ── Master parse ───────────────────────────────────────────────────────────
  function parseText(rawText) {
    const text = cleanText(rawText);
    const name = extractName(text);

    return {
      firstName:    name.firstName,
      lastName:     name.lastName,
      email:        extractEmail(text),
      phone:        extractPhone(text),
      linkedinUrl:  extractLinkedIn(text),
      githubUrl:    extractGitHub(text),
      portfolioUrl: extractPortfolio(text),
      address:      extractAddress(text),
      currentTitle: extractCurrentTitle(text),
      summary:      extractSummary(text),
      skills:       extractSkills(text),
      experience:   extractExperience(text),
      education:    extractEducation(text),
      certifications: extractCertifications(text),
    };
  }

  // ── PDF parsing ────────────────────────────────────────────────────────────
  async function parsePDF(file) {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js not loaded');

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      (typeof chrome !== 'undefined' && chrome.runtime)
        ? chrome.runtime.getURL('lib/pdf.worker.min.js')
        : '../lib/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      // Reconstruct lines by grouping items with similar Y position
      const items = content.items;
      if (!items.length) continue;

      // Sort by Y descending (top of page first), then X ascending
      const sorted = [...items].sort((a, b) => {
        const dy = b.transform[5] - a.transform[5];
        return Math.abs(dy) > 3 ? dy : a.transform[4] - b.transform[4];
      });

      // Group into lines by Y proximity (within 3 units)
      const lineGroups = [];
      let currentLine = [sorted[0]];
      let currentY = sorted[0].transform[5];

      for (let j = 1; j < sorted.length; j++) {
        const item = sorted[j];
        const y = item.transform[5];
        if (Math.abs(y - currentY) <= 3) {
          currentLine.push(item);
        } else {
          lineGroups.push(currentLine);
          currentLine = [item];
          currentY = y;
        }
      }
      lineGroups.push(currentLine);

      // Join each line's items with a space, then join lines with newlines
      const pageText = lineGroups
        .map(group => group.map(item => item.str).join(' ').trim())
        .filter(Boolean)
        .join('\n');

      fullText += pageText + '\n';
    }

    return parseText(fullText);
  }

  // ── DOCX parsing ──────────────────────────────────────────────────────────
  async function parseDOCX(file) {
    if (typeof mammoth === 'undefined') throw new Error('mammoth.js not loaded');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return parseText(result.value);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  async function parse(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf') return parsePDF(file);
    if (ext === 'docx') return parseDOCX(file);
    throw new Error(`Unsupported file type: .${ext}. Please upload a PDF or DOCX file.`);
  }

  return { parse, parseText };
})();

window.ResumeParser = ResumeParser;
