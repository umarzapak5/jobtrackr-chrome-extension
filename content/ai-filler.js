// JobTrackr — AI Chat Filler
// Runs on chatgpt.com and gemini.google.com.
// Reads a pending prompt from storage and fills the chat input.
(function () {
  'use strict';

  if (window.__jobtrackrAiFiller) return;
  window.__jobtrackrAiFiller = true;

  const IS_GEMINI = window.location.hostname.includes('gemini.google.com');

  // Selectors for the chat input on each platform
  // ChatGPT uses a contenteditable div; Gemini uses a rich-textarea / contenteditable
  const INPUT_SELECTORS = IS_GEMINI
    ? ['rich-textarea [contenteditable="true"]', '[data-placeholder] [contenteditable]', 'div[contenteditable="true"]']
    : ['#prompt-textarea', 'div[contenteditable="true"][data-lexical-editor]', 'div[contenteditable="true"]'];

  function findInput() {
    for (const sel of INPUT_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function fillContentEditable(el, text) {
    el.focus();

    // Clear any existing content first
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);

    // Primary method: DataTransfer paste event.
    // React/Lexical (ChatGPT) and Gemini both handle paste events natively
    // and correctly preserve newlines — unlike execCommand('insertText').
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(pasteEvent);

      // Give the editor a moment to process the paste, then verify
      setTimeout(() => {
        const filled = el.innerText || el.textContent || '';
        if (filled.trim().length < 20) {
          // Fallback: set innerHTML with <br> line breaks and fire input
          el.innerHTML = text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
          el.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }
      }, 300);
    } catch (e) {
      // Last resort
      document.execCommand('insertText', false, text);
    }
  }

  function highlightInput(el) {
    const orig = el.style.outline;
    el.style.outline = '2px solid #7c3aed';
    setTimeout(() => { el.style.outline = orig; }, 2000);
  }

  function showBanner(message) {
    const existing = document.getElementById('jobtrackr-ai-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'jobtrackr-ai-banner';
    banner.style.cssText = `
      position:fixed;top:16px;right:16px;z-index:2147483647;
      background:#1e293b;color:#f1f5f9;border:1px solid #7c3aed;
      border-radius:12px;padding:14px 18px;max-width:340px;
      font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;
      font-size:13px;line-height:1.5;box-shadow:0 8px 32px rgba(0,0,0,0.5);
      opacity:0;transition:opacity 0.3s;
    `;
    banner.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px">
        <span style="font-size:18px;line-height:1">🤖</span>
        <div>
          <div style="font-weight:600;margin-bottom:4px;color:#a78bfa">JobTrackr</div>
          <div>${message}</div>
        </div>
      </div>
    `;
    document.body.appendChild(banner);
    requestAnimationFrame(() => { banner.style.opacity = '1'; });
    setTimeout(() => {
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 400);
    }, 6000);
  }

  async function run() {
    let payload;
    try {
      const data = await chrome.storage.local.get('jobtrackr_pending_ai');
      payload = data['jobtrackr_pending_ai'];
    } catch { return; }

    if (!payload || !payload.prompt) return;

    // Ignore stale prompts older than 2 minutes
    if (Date.now() - (payload.timestamp || 0) > 120000) {
      await chrome.storage.local.remove('jobtrackr_pending_ai');
      return;
    }

    // Wait for the input to appear (SPA may load it after a delay)
    let attempts = 0;
    const interval = setInterval(async () => {
      const input = findInput();
      if (input) {
        clearInterval(interval);
        // Extra delay so the editor finishes its own initialization before we paste
        setTimeout(() => {
          fillContentEditable(input, payload.prompt);
          highlightInput(input);
          showBanner('Prompt pre-filled! Attach your resume PDF and hit Send.');
        }, 800);
        await chrome.storage.local.remove('jobtrackr_pending_ai');
      } else if (++attempts > 25) {
        clearInterval(interval);
      }
    }, 600);
  }

  // Run after page settles
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(run, 800));
  } else {
    setTimeout(run, 800);
  }
})();
