import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_WIDTH, MAP_HEIGHT, parseHexId, hexCenter, nearestVisibleHex, pointerToImagePoint, emptyCampaignMap, sanitizeCampaignMap, projectPublicCampaignMap } from '../src/campaign-map.js';

test('canonical geometry maps image pointer coordinates to stable h2 hex ids at either aspect ratio', () => {
  const point=hexCenter({q:4,r:5});
  assert.equal(nearestVisibleHex(point).id,'h2:4:5');
  assert.equal(pointerToImagePoint(50,50,{left:0,top:0,width:100,height:100}).x,MAP_WIDTH/2);
  assert.deepEqual(parseHexId('h2:4:5'),{q:4,r:5,id:'h2:4:5'});
  assert.equal(parseHexId('h2:999:999'),null);
  assert.equal(MAP_HEIGHT/MAP_WIDTH,2/3);
});

test('GM map state preserves hidden editable markers and public projection omits them', () => {
  const gm=emptyCampaignMap(); gm.party='h2:2:3'; gm.flags.red={hex:'h2:3:3',visible:true}; gm.flags.blue={hex:'h2:4:3',visible:false}; gm.enemies=[{id:'enemy-secret',hex:'h2:5:3',visible:false},{id:'enemy-public',hex:'h2:6:3',visible:true}]; gm.factions=[{kind:'alliance',hex:'h2:7:3',visible:false}];
  const canonical=sanitizeCampaignMap(gm), player=projectPublicCampaignMap(canonical);
  assert.equal(canonical.enemies.length,2); assert.equal(canonical.flags.blue.hex,'h2:4:3');
  assert.deepEqual(player.enemies,[{hex:'h2:6:3'}]); assert.deepEqual(player.flags,[{color:'red',hex:'h2:3:3'}]);
  assert.equal(JSON.stringify(player).includes('enemy-secret'),false); assert.equal(player.factions,undefined);
  assert.deepEqual(projectPublicCampaignMap({...canonical,factions:[{kind:'alliance',hex:'h2:7:3',visible:true}]}).factions,[{kind:'alliance',hex:'h2:7:3'}]);
});

test('invalid hex placement and malformed map markers are rejected', () => {
  const map=emptyCampaignMap(); map.party='h2:999:999'; assert.throws(()=>sanitizeCampaignMap(map));
  assert.equal(nearestVisibleHex({x:-1,y:0}),null);
  assert.equal(pointerToImagePoint(1,1,{left:0,top:0,width:0,height:3}),null);
});
