// Line icons (24×24, stroke = currentColor) for categories and controls.
// Hand-drawn paths so the cards do not depend on emoji fonts.
const ICONS = {
  nature: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14"/><path d="M5 19l8-8"/>',
  food: '<path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10"/><path d="M17 21V3c-2 1-3 4-3 8h3"/>',
  tech: '<rect x="6" y="6" width="12" height="12" rx="1"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  sport: '<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 5h-5L8 10z"/><path d="M12 3v4M21 10l-5 0M17 20l-2.5-5M7 20l2.5-5M3 10h5"/>',
  health: '<path d="M12 20s-8-4.6-8-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8 2.8C20 15.4 12 20 12 20z"/><path d="M7 12h3l1.5-3 2 5 1.5-2H17"/>',
  history: '<path d="M6 3h12M6 21h12"/><path d="M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
  economy: '<ellipse cx="10" cy="7" rx="6" ry="2.5"/><path d="M4 7v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7"/><path d="M8 15.8V17c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4c0-1.2-1.8-2.2-4.3-2.4"/>',
  everyday: '<path d="M3 11l9-7 9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  animals: '<circle cx="6" cy="10" r="2"/><circle cx="10" cy="5.5" r="2"/><circle cx="14" cy="5.5" r="2"/><circle cx="18" cy="10" r="2"/><path d="M12 11c-3 0-6 4-6 7a2 2 0 0 0 3 1.7c1.8-1 4.2-1 6 0A2 2 0 0 0 18 18c0-3-3-7-6-7z"/>',
  geography: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  body: '<circle cx="12" cy="4.5" r="2"/><path d="M5 8h14M12 8v6M12 14l-4 7M12 14l4 7"/>',
  space: '<circle cx="12" cy="12" r="5"/><path d="M3.5 15.5C1.8 18 2.2 19.6 4 20c2.6.6 8-2 11.6-5.6S21.2 6.6 20 4c-.6-1.4-2.3-1.6-4.6-.4"/>',
  habits: '<path d="M4 9h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 2.5c-1 1.2 1 2 0 3.5M12 2.5c-1 1.2 1 2 0 3.5"/>',
  all: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  soundOn: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  soundOff: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
};

/** Returns an <svg> element for `name` (aria-hidden; label the parent instead). */
export function icon(name, cls = 'icon') {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.all}</svg>`;
  return wrap.firstChild;
}
