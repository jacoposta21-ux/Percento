// Shared constants for the game, the validator and the build scripts.
// Pure data, no DOM access: this module is imported by Node and the browser.

export const CATEGORIES = {
  nature: { color: '#22c55e', label: 'Nature', family: 'planet', emoji: '🌿' },
  food: { color: '#f59e0b', label: 'Food', family: 'planet', emoji: '🍝' },
  tech: { color: '#3b82f6', label: 'Tech', family: 'society', emoji: '💾' },
  sport: { color: '#ef4444', label: 'Sport', family: 'body', emoji: '🏅' },
  health: { color: '#ec4899', label: 'Health', family: 'body', emoji: '🩺' },
  history: { color: '#d4a017', label: 'History', family: 'past', emoji: '📜' },
  economy: { color: '#14b8a6', label: 'Economy', family: 'society', emoji: '💶' },
  everyday: { color: '#8b5cf6', label: 'Everyday life', family: 'society', emoji: '☕' },
  animals: { color: '#f97316', label: 'Animals', family: 'planet', emoji: '🦔' },
  geography: { color: '#10b981', label: 'Geography', family: 'planet', emoji: '🗺️' },
  body: { color: '#f43f5e', label: 'Human body', family: 'body', emoji: '🫀' },
  space: { color: '#6366f1', label: 'Space', family: 'planet', emoji: '🪐' },
  habits: { color: '#a855f7', label: 'Habits & oddities', family: 'society', emoji: '🧦' },
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
