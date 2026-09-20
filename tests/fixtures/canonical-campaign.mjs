import { adaptPublicCampaignSession } from '../../src/player-contract.js';
import { normalizeCompanionRosterState } from '../../src/companion-rosters.js';

const CAMPAIGN_ID = 'campaign-silver-road';

/**
 * Build one deterministic, synthetic campaign shared by GM integration and
 * Companion parity tests. This is intentionally plain data: no localStorage,
 * browser APIs, network, or production persistence is involved.
 */
export function createCanonicalCampaignFixture() {
  const companionCharacters = [
    {
      contract: 'pf2e-companion/public-character',
      version: 1,
      character: {
        id: 'character-aria', name: 'Aria Vale', level: 4,
        class: 'Ranger', ancestry: 'Elf'
      },
      ownerId: 'player-aria-private',
      characterSheet: { hp: 58, ac: 23, saves: { fort: 12 }, gmNotes: 'Keep the relic secret.' }
    },
    {
      contract: 'pf2e-companion/public-character',
      version: 1,
      character: {
        id: 'character-bram', name: 'Bram Stone', level: 4,
        class: 'Fighter', ancestry: 'Dwarf'
      },
      ownerId: 'player-bram-private',
      characterSheet: { hp: 72, ac: 25, attacks: ['private attack'], gmNotes: 'Player owes the guild.' }
    }
  ];

  const roster = normalizeCompanionRosterState({
    characters: companionCharacters,
    assignments: { [CAMPAIGN_ID]: ['character-aria', 'character-bram'] },
    annotations: {
      'character-aria': { note: 'Ask about the missing map.' },
      'character-bram': { note: 'Private GM annotation.' }
    }
  });

  const combatants = [
    {
      id: 'combat-aria', ref: 'character-aria', isPC: true, init: 21,
      name: 'Aria Vale', hp: 58, ac: 23, saves: { fort: 12 },
      conditions: ['Quickened'], gmNotes: 'PC mechanics stay GM-side.'
    },
    {
      id: 'creature-revealed', ref: 'bestiary-warden', init: 18,
      name: 'Hidden Warden Record', publicVisibility: 'public', publicName: 'Ashen Warden',
      publicDescription: 'A sentinel of the old road.', publicRole: 'guardian',
      publicTraits: ['construct'], publicStatus: ['alert'],
      publicImage: './assets/warden.png', conditions: ['Frightened 1'],
      hp: 140, ac: 29, saves: { fort: 18 }, attacks: ['greatsword +19'],
      weaknesses: ['electricity'], resistances: { physical: 5 },
      sourceId: 'aon-private-warden', gmNotes: 'Reveal the weakness only on a critical recall.'
    },
    {
      id: 'creature-hidden', ref: 'bestiary-secret', init: 16,
      name: 'Invisible Vault Guardian', publicVisibility: 'hidden',
      publicName: 'Vault Guardian', conditions: ['Slowed 2'], hp: 210, ac: 32,
      saves: { fort: 21 }, attacks: ['secret claw +24'], weaknesses: ['fire'],
      resistances: { all: 10 }, sourceId: 'aon-private-secret', gmNotes: 'Do not reveal this encounter.'
    },
    {
      id: 'combat-bram', ref: 'character-bram', isPC: true, init: 12,
      name: 'Bram Stone', hp: 72, ac: 25, saves: { fort: 16 },
      conditions: ['Blessed'], gmNotes: 'Private tactical note.'
    }
  ];

  const base = {
    campaign: {
      id: CAMPAIGN_ID,
      title: 'The Silver Road',
      gmNotes: 'Campaign secret: the road is a decoy.',
      internalSourceId: 'campaign-source-private'
    },
    gm: { id: 'gm-1', role: 'gm', email: 'gm-private@example.test' },
    players: [
      { id: 'player-aria', role: 'player', characterId: 'character-aria' },
      { id: 'player-bram', role: 'player', characterId: 'character-bram' }
    ],
    roster,
    companionCharacters,
    characters: [],
    player: {
      entries: {
        'combat-aria': { token: 'aria-public', name: 'Aria Vale', identity: 'revealed', revealed: true },
        'combat-bram': { token: 'bram-public', name: 'Bram Stone', identity: 'revealed', revealed: true },
        'creature-revealed': {
          token: 'warden-public', name: 'Ashen Warden', identity: 'revealed',
          conditions: true, imageVisible: true
        },
        'creature-hidden': { token: 'secret-public', name: 'Secret Guardian', identity: 'hidden', conditions: true }
      }
    },
    combat: {
      round: 3, activeId: 'creature-revealed',
      order: ['combat-aria', 'creature-revealed', 'creature-hidden', 'combat-bram'],
      combatants
    },
    encounter: {
      title: 'Ashes at the Watchtower', status: 'active',
      entries: [
        { id: 'encounter-warden', kind: 'creature', ref: 'creature-revealed', playerVisible: true, publicIdentity: 'revealed' },
        { id: 'encounter-secret', kind: 'creature', ref: 'creature-hidden', playerVisible: false, publicIdentity: 'hidden' }
      ],
      gmNotes: 'The hidden entry must remain absent from the Companion.'
    },
    revision: 12,
    recap: {
      status: 'updated', revision: 4, title: 'The watchtower stirs',
      body: 'The party found a path beneath the watchtower.',
      gmNotes: 'The sealed vault is still unknown.'
    },
    notes: [
      { public: true, publicId: 'note-road', title: 'Shared route', body: 'The old road bends north.', revision: 2, publicAuthor: 'GM' },
      { public: false, publicId: 'note-secret', title: 'GM secret', body: 'The bridge is trapped.', revision: 1, gmNotes: 'private' }
    ],
    explorationEvents: [
      { id: 'explore-ruins', kind: 'discovery', title: 'Sunken ruins', description: 'A stairway descends beneath the road.', published: true, revision: 2, sourceId: 'private-source' },
      { id: 'explore-vault', kind: 'objective', title: 'Find the sealed vault', description: 'Do not reveal this yet.', published: false, revision: 1, gmNotes: 'secret' }
    ],
    downtimeRecords: [
      { id: 'downtime-earn', kind: 'activity', title: 'Earn Income', description: 'Work during the quiet days.', published: true, revision: 1, privateDC: 20 },
      { id: 'downtime-secret', kind: 'result', title: 'Hidden result', publicResultText: 'Secret result', published: false, gmNotes: 'private' },
      { id: 'downtime-public-result', kind: 'result', title: 'Town remembers', publicResultText: 'The town remembers your help.', published: true, revision: 2, privateDC: 25 }
    ],
    announcements: [
      { id: 'announcement-table', campaignId: CAMPAIGN_ID, title: 'At the table', message: 'Meet at the watchtower.', published: true, revision: 1, createdAt: 100 },
      { id: 'announcement-secret', campaignId: CAMPAIGN_ID, title: 'GM-only', body: 'The traitor arrives tonight.', published: false, gmNotes: 'private' }
    ],
    events: [
      { id: 'legacy-public', message: 'Bring your maps.', public: true, campaignId: CAMPAIGN_ID },
      { id: 'legacy-secret', message: 'Private GM plan.', public: false, campaignId: CAMPAIGN_ID }
    ]
  };

  return {
    campaignId: CAMPAIGN_ID,
    gm: base,
    phases: Object.fromEntries(['downtime', 'exploration', 'combat'].map(phase => [
      phase, { ...base, session: { phase, revision: base.revision } }
    ]))
  };
}

export function companionProjection(fixture, phase = 'combat') {
  const state = fixture?.phases?.[phase] || fixture?.gm;
  return adaptPublicCampaignSession(state);
}
