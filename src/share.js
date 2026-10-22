// Daily Challenge share text (Wordle-style) and the share/copy flow.

export function shareText({ date, answers, url }) {
  const score = answers.filter(Boolean).length;
  const grid = answers.map((ok) => (ok ? '🟩' : '🟥')).join('');
  return `PERCENTO Daily ${date}: ${score}/${answers.length}\n${grid}\n${url}`;
}

const isTouchDevice = () =>
  typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/**
 * Native share sheet on touch devices when available, clipboard otherwise.
 * Returns 'shared' | 'copied' | 'cancelled' | 'failed'.
 */
export async function shareResult(text) {
  if (isTouchDevice() && navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  return (await copyText(text)) ? 'copied' : 'failed';
}
