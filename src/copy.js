// All player-facing copy lives here. Playful, ironic, never mean.

export const TAGLINE = 'Compare the incomparable.';
export const INSTRUCTION = 'Tap the higher percentage.';

export const HEADLINES = [
  'Impossible comparison.',
  'Apples and oranges? Much worse.',
  'Nobody asked for this matchup.',
  'Two numbers walk into a bar.',
  'A comparison no statistician would approve.',
  'Science did not see this coming.',
  'Same dial, different universes.',
  'Totally unrelated. Strictly measured.',
  'This pairing is legally distinct from sense.',
  'Your gut feeling, versus reality.',
  'One of these is bigger. Allegedly.',
  'Brought together by pure chaos.',
  'Eyeball is ready. Are you?',
  'Peer-reviewed, never peer-compared.',
  'An official statistic meets its nemesis.',
  'Context has left the building.',
  'They have nothing in common except a percent sign.',
  'A duel nobody trained for.',
  'Relevance: zero. Accuracy: total.',
  'Two facts, one very confused dial.',
  'Compare the incomparable.',
  'Somewhere, an analyst just fainted.',
  'Spreadsheets from two different planets.',
  'Fact versus fact. No referee.',
  'Your favourite trivia night, but louder.',
  'Mismatched on purpose.',
  'Let the numbers sort it out.',
  'Coin flip? Never. Pure data.',
];

export const RIGHT_QUIPS = [
  'Correct. Suspiciously correct.',
  'Nailed it. Eyeball is impressed.',
  'Right! Have you been reading statistical yearbooks?',
  'Yes! Your intuition is officially calibrated.',
  'Correct. Somewhere a census taker smiles.',
  'Spot on. Frame this moment.',
  'Right again. This is getting statistically significant.',
  'Correct! Margin of error: you.',
  'Yes. The needle agrees with you.',
  'Correct. Nobody saw that coming. Except you.',
  'Right. Smug face permitted.',
  'Correct! Data and destiny aligned.',
  'Bingo. The numbers bow politely.',
  'Correct. You may now explain this at dinner parties.',
  'Right! That was not supposed to be guessable.',
  'Correct. A footnote in history, but yours.',
];

export const WRONG_QUIPS = [
  'Wrong, but in a very relatable way.',
  'Not quite. The numbers had other plans.',
  'Nope. Reality is weirder than it looks.',
  'Close in spirit, far in percentage points.',
  'Wrong! Blame the universe, it made these numbers.',
  'Missed it. Eyeball remains unbothered.',
  'Not this time. Statistics: 1, intuition: 0.',
  'Wrong, and honestly, fair enough.',
  'The data disagrees. Respectfully.',
  'Oof. That one fooled everyone.',
  'Nope. But now you know something odd.',
  'Wrong! A completely reasonable mistake.',
];

export const GAME_OVER_LINES = [
  { max: 0, lines: ['A bold start. Statistically, the only way is up.', 'Zero. Even the needle felt that.'] },
  { max: 2, lines: ['A warm-up round, clearly.', 'Respectable. For a Monday.'] },
  { max: 5, lines: ['Solid. Your gut has a decent dataset.', 'Not bad. Eyeball nods.'] },
  { max: 9, lines: ['Impressive. You have opinions about yearbooks.', 'Strong run. Someone call a statistics office.'] },
  { max: 19, lines: ['Remarkable. Are you secretly a census?', 'Wow. The dial needs a lie-down.'] },
  { max: Infinity, lines: ['Legendary. You are now a measured phenomenon.', 'Unbelievable. Literally: please verify yourself.'] },
];

export const DAILY_END_LINES = [
  { max: 3, lines: ["Today's numbers won. Tomorrow is a new dataset."] },
  { max: 6, lines: ['Not bad. Eyeball gives you a polite thumbs-up.'] },
  { max: 9, lines: ['Great day. Your intuition is statistically sound.'] },
  { max: 10, lines: ['Perfect ten. Please report to the nearest statistics office.'] },
];

export const pickByScore = (table, score, index = 0) => {
  const row = table.find((r) => score <= r.max) || table[table.length - 1];
  return row.lines[index % row.lines.length];
};
