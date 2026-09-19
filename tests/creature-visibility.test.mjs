import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CREATURE_VISIBILITY,
  CREATURE_VISIBILITY_LEVELS,
  creatureVisibility,
  creatureVisibilityPolicy,
  visibilityCapabilities
} from '../src/creature-visibility.js';

test('visibility policy has the documented ordered levels', () => {
  assert.deepEqual(CREATURE_VISIBILITY_LEVELS, [
    'hidden', 'presence', 'image', 'identity', 'public'
  ]);
  assert.deepEqual(visibilityCapabilities(CREATURE_VISIBILITY.IMAGE), {
    level: 'image', present: true, image: true, identity: false, metadata: false
  });
});

test('policy resolves each supported state without exposing mechanics', () => {
  const cases = [
    [{ publicVisibility: 'hidden', hp: 999, ac: 40 }, 'hidden'],
    [{ publicVisibility: 'presence', hp: 999, name: 'Secret' }, 'presence'],
    [{ publicVisibility: 'image', publicImage: './dragon.png', hp: 999 }, 'image'],
    [{ publicVisibility: 'identity', publicName: 'Dragon', hp: 999 }, 'identity'],
    [{ publicVisibility: 'public', publicName: 'Dragon', hp: 999 }, 'public']
  ];
  for (const [record, expected] of cases) {
    assert.equal(creatureVisibility(record), expected);
    assert.equal(creatureVisibilityPolicy(record).level, expected);
  }
});

test('unknown policy states fail closed, including legacy malformed values', () => {
  assert.equal(creatureVisibility({ publicVisibility: 'everyone', publicVisible: true }), 'hidden');
  assert.equal(creatureVisibility({ visibility: null, publicVisible: true }), 'hidden');
  assert.equal(creatureVisibility({ publicIdentity: 'mystery', publicVisible: true }), 'presence');
  assert.equal(creatureVisibility({ publicImageVisible: true }), 'hidden');
  assert.equal(creatureVisibility({ publicImageVisible: true, publicVisible: true }), 'image');
});

test('hidden wins over stale reveal fields and private metadata is not a capability', () => {
  const policy = creatureVisibilityPolicy({
    publicVisibility: 'hidden', publicVisible: true, publicIdentity: 'revealed',
    publicMetadata: true, publicImageVisible: true, hp: 100
  });
  assert.deepEqual(policy, {
    level: 'hidden', present: false, image: false, identity: false, metadata: false
  });
});

