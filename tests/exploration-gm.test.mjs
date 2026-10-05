import test from 'node:test';
import assert from 'node:assert/strict';
import { explorationMarkup } from '../src/views/exploration-gm.js';
import { emptyCampaignMap } from '../src/campaign-map.js';

const props={campaignId:'campaign-a',characters:[{id:'hero-a',name:'Kesta',playerName:'Morgan'}],workflow:{revision:4,characters:[{characterId:'hero-a',playerName:'Morgan',exploration:{activityId:'action-2629',activityName:'Scout'}}]},activityOptions:[{id:'action-2629',name:'Scout',notes:'You scout ahead and behind the group.'}],map:emptyCampaignMap(),revision:3};

test('populated and missing activity states show player identity, selected activity, and authoritative effect text',()=>{
  const populated=explorationMarkup(props);
  assert.match(populated,/Morgan/); assert.match(populated,/Scout/); assert.match(populated,/You scout ahead and behind the group/);
  assert.match(populated,/data-activity="hero-a"/); assert.match(populated,/No activity/);
  const missing=explorationMarkup({...props,workflow:{revision:5,characters:[]}});
  assert.match(missing,/No activity selected/);
});

test('map markup exposes accessible keyboard placement, independent marker visibility, and responsive image contract',()=>{
  const map=emptyCampaignMap(); map.flags.red={hex:'h2:1:1',visible:true}; map.flags.blue={hex:'h2:2:1',visible:false}; map.enemies=[{id:'enemy-secret',hex:'h2:3:1',visible:false}];
  const html=explorationMarkup({...props,map});
  assert.match(html,/aspect-ratio|width="1536"/); assert.match(html,/data-place-hex/); assert.match(html,/aria-label="Place selected marker on map"/);
  assert.match(html,/data-visibility="red" checked/); assert.match(html,/data-visibility="blue"/); assert.match(html,/data-enemy-visibility="enemy-secret"/);
  assert.match(html,/Faded markers are GM only/); assert.match(html,/Player view/);
});
