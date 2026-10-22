import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findEvidence, hedgedBefore, htmlToText, normalize, valueMatchesEvidence, valueOffset } from '../scripts/verify-sources.mjs';

const page = normalize(htmlToText(`<html><body><table><tr><td>Watching television</td><td>2.61</td>
  <td>2.81</td><td>2.42</td><td>74.3</td></tr></table><p>About 71 percent of the Earth's surface is water-covered.</p>
  <p>nearly two thirds (65%) of the EU population</p><script>var x = "74.3";</script></body></html>`));

test('evidence is found across table cells', () => {
  assert.ok(findEvidence(page, 'Watching television 2.61 2.81 2.42 74.3') >= 0);
  assert.ok(findEvidence(page, 'Watching television … 74.3') >= 0);
  assert.equal(findEvidence(page, 'Watching television 2.61 9.99'), -1);
});

test('hedges right before the number are detected', () => {
  const at = findEvidence(page, 'About 71 percent');
  const span = page.slice(at, at + 100);
  assert.equal(hedgedBefore(page, at + valueOffset(span, 71)), true);
  const at2 = findEvidence(page, 'nearly two thirds (65%)');
  assert.equal(hedgedBefore(page, at2 + valueOffset(page.slice(at2, at2 + 100), 65)), false);
});

test('value must be a number in the evidence', () => {
  assert.equal(valueMatchesEvidence(78.1, '78.08% Nitrogen'), true);
  assert.equal(valueMatchesEvidence(38, '0.380'), true);
  assert.equal(valueMatchesEvidence(14.5, '14,5%'), true);
  assert.equal(valueMatchesEvidence(50, '74.3'), false);
});
