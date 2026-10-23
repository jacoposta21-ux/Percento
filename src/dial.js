// The ruler: a 0–100 ruler with one marker per card. Markers swing
// past the target, oscillate and settle; a callback receives the marker's
// current reading on every frame so numbers and grids count in sync.

const NS = 'http://www.w3.org/2000/svg';
const W = 320;
const LEFT = 14;
const RIGHT = W - 14;
const BASE = 46;

const el = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const xFor = (value) => LEFT + ((RIGHT - LEFT) * Math.max(0, Math.min(100, value))) / 100;

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && (document.documentElement.classList.contains('reduce-motion')
    || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));

/** Damped oscillation from `from` to `to`; t in [0, 1]. Ends exactly on `to`. */
export function needlePosition(from, to, t) {
  if (t >= 1) return to;
  const decay = Math.exp(-4.2 * t);
  return to + (from - to) * decay * Math.cos(3.2 * Math.PI * t);
}

export function createDial() {
  const svg = el('svg', { viewBox: `0 0 ${W} 64`, class: 'dial', role: 'img', 'aria-label': 'Percentage ruler' });
  svg.append(el('line', { x1: LEFT, y1: BASE, x2: RIGHT, y2: BASE, class: 'dial-track' }));
  for (let v = 0; v <= 100; v += 2) {
    const major = v % 10 === 0;
    svg.append(el('line', { x1: xFor(v), y1: BASE, x2: xFor(v), y2: BASE - (v % 50 === 0 ? 14 : major ? 9 : 4), class: major ? 'dial-tick major' : 'dial-tick' }));
  }
  for (const v of [0, 25, 50, 75, 100]) {
    const label = el('text', { x: xFor(v), y: BASE + 15, class: 'dial-label', 'text-anchor': 'middle' });
    label.textContent = String(v);
    svg.append(label);
  }
  const needles = {};
  for (const id of ['a', 'b']) {
    const g = el('g', { class: `needle needle-${id}`, transform: `translate(${xFor(0)} 0)` });
    // A pin pointing at the ruler, labelled L or R like the cards.
    g.append(el('polygon', { points: `0,${BASE - 2} -7,${BASE - 16} 7,${BASE - 16}` }));
    g.append(el('rect', { x: -1.5, y: 14, width: 3, height: BASE - 30 }));
    const tag = el('text', { x: 0, y: 11, class: 'needle-tag', 'text-anchor': 'middle' });
    tag.textContent = id === 'a' ? 'L' : 'R';
    g.append(tag);
    g.style.opacity = '0';
    svg.append(g);
    needles[id] = { g, value: 0 };
  }

  const place = (id, value) => {
    needles[id].value = value;
    needles[id].g.setAttribute('transform', `translate(${xFor(value)} 0)`);
  };

  return {
    el: svg,
    /** Animates a marker to `to`. onFrame(reading) gets the clamped reading. */
    swing(id, to, onFrame, duration = 1700) {
      const from = needles[id].value;
      needles[id].g.style.opacity = '1';
      if (prefersReducedMotion() || duration <= 0) {
        place(id, to);
        onFrame?.(to);
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const start = performance.now();
        const frame = (now) => {
          const t = Math.min(1, (now - start) / duration);
          const v = needlePosition(from, to, t);
          place(id, v);
          onFrame?.(Math.max(0, Math.min(100, v)));
          if (t < 1) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
    },
    describe(text) {
      svg.setAttribute('aria-label', text);
    },
  };
}
