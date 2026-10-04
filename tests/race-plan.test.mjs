import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeState } from '../src/store.js';

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('Wargames race plan keeps the six canon legs in order and separates phase one', async () => {
  const campaign = await readJson('../data/campaign.json');
  const race = campaign.arcs.find(arc => arc.id === 'wargame').race;
  assert.equal(race.phase, 'Phase 1');
  assert.deepEqual(race.teams, ['Mists of Zalazar', 'The Alliance', 'The Royal Guard']);
  const roster = await readJson('../data/characters.json');
  assert.deepEqual(roster.groups.filter(group => race.teams.includes(group.label)).map(group => group.id), [
    'mists-of-zalazar', 'the-alliance', 'the-royal-guard'
  ]);
  assert.deepEqual(race.legs.map(leg => leg.name), [
    'Pyramid Escape', 'Village Leg', 'Dinosaur Plains', 'Mountain Area', 'Jungle Area', 'Final Stretch'
  ]);
  const canon = race.legs.map(leg => leg.guidance).join(' ');
  for (const phrase of ['King\'s Throne', 'portal', 'comedic', 'overly compensate', 'stampede', 'Henza', 'Earth Kinesis', 'third route', 'visible race']) {
    assert.ok(canon.toLowerCase().includes(phrase.toLowerCase()), `missing ${phrase}`);
  }
  assert.match(race.scope, /before the secret cooking competition/i);
  assert.doesNotMatch(canon, /ingredients|food gathering/i);
});

test('Race music folder contains the exact eight supplied labels and clickable URLs', async () => {
  const soundtrack = await readJson('../data/soundtrack.json');
  const race = soundtrack.groups.find(group => group.label === 'Race');
  assert.equal(race.key, 'race');
  assert.equal(race.random, false);
  assert.deepEqual(race.tracks, [
    ['Race #1', 'https://www.youtube.com/watch?v=o6AWxpUlkn8&list=RDo6AWxpUlkn8'],
    ['Race #2', 'https://www.youtube.com/watch?v=8297dMX9isQ&list=RD8297dMX9isQ'],
    ['Race Start', 'https://www.youtube.com/watch?v=HnRyik7au9E&list=RDHnRyik7au9E'],
    ['Village Leg', 'https://www.youtube.com/watch?v=FV85V13bcog&list=RDFV85V13bcog'],
    ['Stampede', 'https://www.youtube.com/watch?v=sOJixyIhAx8&list=RDsOJixyIhAx8'],
    ['Mountain Area', 'https://www.youtube.com/watch?v=UeizZVg5T8c&list=RDUeizZVg5T8c'],
    ['Jungle Area', 'https://www.youtube.com/watch?v=NzF_uHgycVo&list=RDNzF_uHgycVo'],
    ['Final Stretch', 'https://www.youtube.com/watch?v=BC-SCz07SHQ&list=RDBC-SCz07SHQ']
  ].map(([label, url]) => ({ label, url })));
});

test('race tracker state persists independent racer entries and drops malformed entries', () => {
  const normalized = normalizeState({ race: { entries: [
    { id: 'one', team: 'The Alliance', racers: 'Kali', leg: 3, route: 'Tunnel' },
    null,
    ['invalid']
  ] } });
  assert.deepEqual(normalized.race.entries, [
    { id: 'one', team: 'The Alliance', racers: 'Kali', leg: 3, route: 'Tunnel' }
  ]);
});
