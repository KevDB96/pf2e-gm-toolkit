import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REVEAL_CATEGORIES,
  REVEAL_TIERS,
  advanceRevealTier,
  isRevealCategory,
  isRevealTier,
  normalizeRevealState,
  publicRevealDecisions,
  retractRevealTier
} from '../src/reveal-progression.js';

test('reveal state advances and retracts only through known tiers', () => {
  const initial = normalizeRevealState({ tier: 'unknown', decisions: [{ tier: 'basic', category: 'appearance', labels: ['Scaled'] }] });
  assert.deepEqual(initial, { tier: 'none', decisions: [{ tier: 'basic', category: 'appearance', labels: ['Scaled'] }] });
  const basic = advanceRevealTier(initial);
  assert.equal(basic.tier, 'basic');
  assert.equal(advanceRevealTier(basic, 'not-a-tier').tier, 'basic');
  const detailed = advanceRevealTier(basic, 'detailed');
  assert.equal(detailed.tier, 'detailed');
  assert.equal(retractRevealTier(detailed).tier, 'known');
  assert.equal(retractRevealTier(detailed, 'not-a-tier').tier, 'detailed');
});

test('unknown categories and unsafe values fail closed while valid decisions stay labels only', () => {
  const state = normalizeRevealState({ tier: 'detailed', decisions: [
    { tier: 'basic', category: 'appearance', labels: ['Scaled', 'Scaled', 3] },
    { tier: 'known', category: 'traits', value: 'Beast' },
    { tier: 'known', category: 'weaknesses', labels: ['fire'] },
    { tier: 'known', category: 'role', labels: [{ sourceId: 'secret' }] },
    { tier: 'detailed', category: 'lore', labels: ['Watches the old road'], hp: 99 }
  ] });
  assert.deepEqual(publicRevealDecisions(state), [
    { category: 'appearance', labels: ['Scaled'] },
    { category: 'traits', labels: ['Beast'] },
    { category: 'lore', labels: ['Watches the old road'] }
  ]);
  assert.deepEqual(publicRevealDecisions({ ...state, tier: 'basic' }), [
    { category: 'appearance', labels: ['Scaled'] }
  ]);
  assert.equal(isRevealTier('detailed'), true);
  assert.equal(isRevealTier('gm-only'), false);
  assert.equal(isRevealCategory(REVEAL_CATEGORIES[0]), true);
  assert.equal(isRevealCategory('weaknesses'), false);
  assert.deepEqual(REVEAL_TIERS, ['none', 'basic', 'known', 'detailed']);
});
