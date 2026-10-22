// The Percentometer: an SVG half-dial with two needles (one per card).
// Needles swing past the target, oscillate and settle; a callback receives
// the needle's current reading on every frame so numbers count in sync.

const NS = 'http://www.w3.org/2000/svg';
const CX = 100;
const CY = 104;
const R = 82;

const el = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const angleFor = (value) => -90 + (Math.max(0, Math.min(100, value)) * 180) / 100;

const pointAt = (value, radius) => {
  const rad = ((180 - value * 1.8) * Math.PI) / 180;
  return [CX + radius * Math.cos(rad), CY - radius * Math.sin(rad)];
};

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
  const svg = el('svg', { viewBox: '0 0 200 120', class: 'dial', role: 'img', 'aria-label': 'Percentometer' });
  const [x0, y0] = pointAt(0, R);
  const [x1, y1] = pointAt(100, R);
  svg.append(el('path', { d: `M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1}`, class: 'dial-track' }));
  for (let v = 0; v <= 100; v += 5) {
    const major = v % 25 === 0;
    const [ax, ay] = pointAt(v, R - (major ? 12 : 7));
    const [bx, by] = pointAt(v, R - 2);
    svg.append(el('line', { x1: ax, y1: ay, x2: bx, y2: by, class: major ? 'dial-tick major' : 'dial-tick' }));
  }
  for (const v of [0, 50, 100]) {
    const [tx, ty] = pointAt(v, R - 28);
    const label = el('text', { x: tx, y: ty + 4, class: 'dial-label', 'text-anchor': 'middle' });
    label.textContent = `${v}%`;
    svg.append(label);
  }
  const needles = {};
  for (const id of ['a', 'b']) {
    const g = el('g', { class: `needle needle-${id}`, transform: `rotate(${angleFor(0)} ${CX} ${CY})` });
    g.append(el('polygon', { points: `${CX - 3.2},${CY} ${CX},${CY - R + 10} ${CX + 3.2},${CY}` }));
    g.style.opacity = '0';
    svg.append(g);
    needles[id] = { g, value: 0 };
  }
  svg.append(el('circle', { cx: CX, cy: CY, r: 7, class: 'dial-hub' }));

  const place = (id, value) => {
    needles[id].value = value;
    needles[id].g.setAttribute('transform', `rotate(${angleFor(value)} ${CX} ${CY})`);
  };

  return {
    el: svg,
    show(id, value) {
      needles[id].g.style.opacity = '1';
      place(id, value);
    },
    hide(id) {
      needles[id].g.style.opacity = '0';
      place(id, 0);
    },
    /** Animates a needle to `to`. onFrame(reading) gets the clamped reading. */
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
