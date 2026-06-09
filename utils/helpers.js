// Relative time formatting
function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (weeks === 1) return '1 week ago';
  if (weeks < 5) return `${weeks} weeks ago`;
  if (months === 1) return '1 month ago';
  return `${months} months ago`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Status configuration
const STATUS_CONFIG = {
  Applied:    { color: '#38bdf8', bg: 'rgba(56,189,248,0.15)',  label: 'Applied' },
  'Phone Screen': { color: '#38bdf8', bg: 'rgba(56,189,248,0.15)', label: 'Phone Screen' },
  Technical:  { color: '#a78bfa', bg: 'rgba(167,139,250,0.15)', label: 'Technical' },
  'Final Round': { color: '#818cf8', bg: 'rgba(129,140,248,0.15)', label: 'Final Round' },
  Offer:      { color: '#34d399', bg: 'rgba(52,211,153,0.15)',  label: 'Offer' },
  Rejected:   { color: '#f87171', bg: 'rgba(248,113,113,0.15)', label: 'Rejected' },
  Ghosted:    { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)',  label: 'Ghosted' },
  Withdrawn:  { color: '#64748b', bg: 'rgba(100,116,139,0.15)', label: 'Withdrawn' },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG);

// Platform configuration
const PLATFORM_CONFIG = {
  linkedin:     { label: 'LinkedIn',    color: '#0a66c2', bg: 'rgba(10,102,194,0.2)' },
  indeed:       { label: 'Indeed',      color: '#6b4fbb', bg: 'rgba(107,79,187,0.2)' },
  greenhouse:   { label: 'Greenhouse',  color: '#24a547', bg: 'rgba(36,165,71,0.2)' },
  lever:        { label: 'Lever',       color: '#1565c0', bg: 'rgba(21,101,192,0.2)' },
  workday:      { label: 'Workday',     color: '#e05c2c', bg: 'rgba(224,92,44,0.2)' },
  glassdoor:    { label: 'Glassdoor',   color: '#0caa41', bg: 'rgba(12,170,65,0.2)' },
  ziprecruiter: { label: 'ZipRecruiter', color: '#2196f3', bg: 'rgba(33,150,243,0.2)' },
  dice:         { label: 'Dice',        color: '#e91e63', bg: 'rgba(233,30,99,0.2)' },
  wellfound:    { label: 'Wellfound',   color: '#7c3aed', bg: 'rgba(124,58,237,0.2)' },
  other:        { label: 'Other',       color: '#64748b', bg: 'rgba(100,116,139,0.2)' },
};

function getPlatformFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('linkedin')) return 'linkedin';
    if (hostname.includes('indeed')) return 'indeed';
    if (hostname.includes('greenhouse')) return 'greenhouse';
    if (hostname.includes('lever')) return 'lever';
    if (hostname.includes('myworkdayjobs') || hostname.includes('workday')) return 'workday';
    if (hostname.includes('glassdoor')) return 'glassdoor';
    if (hostname.includes('ziprecruiter')) return 'ziprecruiter';
    if (hostname.includes('dice')) return 'dice';
    if (hostname.includes('wellfound') || hostname.includes('angel.co')) return 'wellfound';
    return 'other';
  } catch {
    return 'other';
  }
}

function createStatusBadge(status) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG['Applied'];
  const el = document.createElement('span');
  el.className = 'badge';
  el.textContent = cfg.label;
  el.style.cssText = `color:${cfg.color};background:${cfg.bg};`;
  return el;
}

function createPlatformBadge(platform) {
  const key = (platform || 'other').toLowerCase();
  const cfg = PLATFORM_CONFIG[key] || PLATFORM_CONFIG['other'];
  const el = document.createElement('span');
  el.className = 'badge';
  el.textContent = cfg.label;
  el.style.cssText = `color:${cfg.color};background:${cfg.bg};`;
  return el;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

if (typeof window !== 'undefined') {
  window.JobTrackrHelpers = {
    timeAgo, formatDate, STATUS_CONFIG, ALL_STATUSES, PLATFORM_CONFIG,
    getPlatformFromUrl, createStatusBadge, createPlatformBadge,
    escapeHtml, debounce, downloadFile,
  };
}
