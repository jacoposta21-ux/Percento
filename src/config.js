// Shared constants for the game, the validator and the build scripts.
// Pure data, no DOM access: this module is imported by Node and the browser.

export const CATEGORIES = {
  nature: { label: 'Nature', family: 'planet', emoji: '🌿' },
  food: { label: 'Food', family: 'planet', emoji: '🍝' },
  tech: { label: 'Tech', family: 'society', emoji: '💾' },
  sport: { label: 'Sport', family: 'body', emoji: '🏅' },
  health: { label: 'Health', family: 'body', emoji: '🩺' },
  history: { label: 'History', family: 'past', emoji: '📜' },
  economy: { label: 'Economy', family: 'society', emoji: '💶' },
  everyday: { label: 'Everyday life', family: 'society', emoji: '☕' },
  animals: { label: 'Animals', family: 'planet', emoji: '🦔' },
  geography: { label: 'Geography', family: 'planet', emoji: '🗺️' },
  body: { label: 'Human body', family: 'body', emoji: '🫀' },
  space: { label: 'Space', family: 'planet', emoji: '🪐' },
  habits: { label: 'Habits & oddities', family: 'society', emoji: '🧦' },
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
