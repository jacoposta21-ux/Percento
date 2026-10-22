// Shared constants for the game, the validator and the build scripts.
// Pure data, no DOM access: this module is imported by Node and the browser.

export const CATEGORIES = {
  nature: { color: '#3f9b5a', label: 'Nature', family: 'planet', emoji: '🌿' },
  food: { color: '#d98b2b', label: 'Food', family: 'planet', emoji: '🍝' },
  tech: { color: '#2f6fd6', label: 'Tech', family: 'society', emoji: '💾' },
  sport: { color: '#e5483b', label: 'Sport', family: 'body', emoji: '🏅' },
  health: { color: '#e06c9f', label: 'Health', family: 'body', emoji: '🩺' },
  history: { color: '#a8794a', label: 'History', family: 'past', emoji: '📜' },
  economy: { color: '#1d9e8e', label: 'Economy', family: 'society', emoji: '💶' },
  everyday: { color: '#f07f3c', label: 'Everyday life', family: 'society', emoji: '☕' },
  animals: { color: '#8a9a3a', label: 'Animals', family: 'planet', emoji: '🦔' },
  geography: { color: '#4fa3c7', label: 'Geography', family: 'planet', emoji: '🗺️' },
  body: { color: '#c2416b', label: 'Human body', family: 'body', emoji: '🫀' },
  space: { color: '#33478f', label: 'Space', family: 'planet', emoji: '🪐' },
  habits: { color: '#d9bf2f', label: 'Habits & oddities', family: 'society', emoji: '🧦' },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES);
export const TONES = ['serious', 'curious', 'silly'];
export const STATUSES = ['verified', 'unverified'];

export const RULES = {
  minGap: 3, // never pair values less than this many points apart
  crossFamilyBias: 0.92, // probability of forcing a cross-family pair when one exists
  dailyPairs: 10,
  maxTextLength: 70, // short, popular card titles
  maxDetailLength: 60, // the small print: place, age group, year
  maxPerIndicator: 3,
  maxSourceShare: 0.15,
  maxCountryShare: 0.2,
  minLightToneShare: 0.4,
  minTotal: 300,
  minCategories: 13,
  minPerCategory: 20,
  nearDuplicateThreshold: 0.8,
};

export const familyOf = (category) => CATEGORIES[category]?.family;

// Daily Challenge clock.
export const DAILY_TIMEZONE = 'Europe/Rome';
