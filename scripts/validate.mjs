// CLI: node scripts/validate.mjs --mode=production|dev [--quiet]
// Exits with code 1 on any error so builds fail.
import { loadEntries, argValue } from './lib/data.mjs';
import { validateDataset } from './lib/validate.mjs';

const mode = argValue('mode', 'production');
const { errors, warnings, stats } = validateDataset(loadEntries(), { mode });

if (!process.argv.includes('--quiet')) console.log(JSON.stringify(stats, null, 2));
for (const w of warnings) console.warn(`warning: ${w}`);
for (const e of errors) console.error(`error: ${e}`);
console.log(`\n${mode}: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
