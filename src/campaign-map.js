// Runtime JavaScript port of the authoritative PFPC campaign-map geometry.
export const MAP_WIDTH = 1536, MAP_HEIGHT = 1024;
const HEX_ORIGIN_X = 41.5, HEX_ORIGIN_Y = 26.5, HEX_COLUMN_PITCH = 57.7, HEX_ROW_PITCH = 65.2;
const HEX_ODD_COLUMN_OFFSET = HEX_ROW_PITCH / 2;
const inside = p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x < MAP_WIDTH && p.y >= 0 && p.y < MAP_HEIGHT;
const gridCenter = ({ q, r }) => ({ x: HEX_ORIGIN_X + q * HEX_COLUMN_PITCH, y: HEX_ORIGIN_Y + r * HEX_ROW_PITCH + (Math.abs(q % 2) ? HEX_ODD_COLUMN_OFFSET : 0) });
const legacyCenter = ({ q, r }) => ({ x: 22 + q * 88, y: 2 + r * 76 + (Math.abs(q % 2) ? 38 : 0) });
function closest(point) {
  if (!inside(point)) return;
  let best;
  const qMin = Math.max(0, Math.floor((point.x - HEX_ORIGIN_X) / HEX_COLUMN_PITCH) - 1);
  const qMax = Math.ceil((MAP_WIDTH - HEX_ORIGIN_X) / HEX_COLUMN_PITCH);
  const rMin = Math.max(-1, Math.floor((point.y - HEX_ORIGIN_Y - HEX_ODD_COLUMN_OFFSET) / HEX_ROW_PITCH) - 1);
  const rMax = Math.ceil((MAP_HEIGHT - HEX_ORIGIN_Y) / HEX_ROW_PITCH);
  for (let q=qMin;q<=qMax;q++) for(let r=rMin;r<=rMax;r++) { const c=gridCenter({q,r}); if(!inside(c)) continue; const distance=(c.x-point.x)**2+(c.y-point.y)**2; if(!best||distance<best.distance) best={q,r,distance}; }
  return best;
}
export function parseHexId(value) {
  if (typeof value !== 'string') return null;
  const m=/^(h2?):(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(value); if(!m) return null;
  const q=Number(m[2]),r=Number(m[3]); if(!Number.isSafeInteger(q)||!Number.isSafeInteger(r)) return null;
  const legacy=m[1]==='h', point=legacy?legacyCenter({q,r}):gridCenter({q,r});
  if(!inside(point)) return null;
  return {q,r,id:value,...(legacy?{legacy:true}:{})};
}
export function hexCenter(hex) {
  if(!hex.legacy) return gridCenter(hex);
  const point=legacyCenter(hex), nearest=closest(point); return nearest?gridCenter(nearest):point;
}
export function nearestVisibleHex(point) { const best=closest(point); return !best||best.distance>39**2?null:{q:best.q,r:best.r,id:`h2:${best.q}:${best.r}`}; }
export function pointerToImagePoint(x,y,bounds) { if(bounds.width<=0||bounds.height<=0)return null; const p={x:(x-bounds.left)*MAP_WIDTH/bounds.width,y:(y-bounds.top)*MAP_HEIGHT/bounds.height}; return inside(p)?p:null; }

export function emptyCampaignMap() { return {party:null,flags:{red:{hex:null,visible:false},yellow:{hex:null,visible:false},blue:{hex:null,visible:false}},enemies:[]}; }
export function sanitizeCampaignMap(value) {
  const keys=Object.keys(value||{}); if(!value||typeof value!=='object'||Array.isArray(value)||keys.length!==Object.keys(value).length||keys.some(k=>!['party','flags','enemies','factions'].includes(k))||!(value.party===null||parseHexId(value.party))||!value.flags||!Array.isArray(value.enemies)||value.enemies.length>100) throw new Error('Invalid campaign map');
  const flags={}; if(!value.flags||Object.keys(value.flags).length!==3||Object.keys(value.flags).some(k=>!['red','yellow','blue'].includes(k)))throw new Error('Invalid campaign flags'); for(const color of ['red','yellow','blue']) { const f=value.flags[color]; if(!f||Object.keys(f).length!==2||!('hex'in f)||!('visible'in f)||!(f.hex===null||parseHexId(f.hex))||typeof f.visible!=='boolean') throw new Error('Invalid campaign flag'); flags[color]={hex:f.hex,visible:f.visible}; }
  const ids=new Set(); const enemies=value.enemies.map(e=>{if(!e||Object.keys(e).length!==3||typeof e.id!=='string'||!/^enemy-[a-zA-Z0-9_-]{1,60}$/.test(e.id)||ids.has(e.id)||!parseHexId(e.hex)||typeof e.visible!=='boolean')throw new Error('Invalid campaign enemy');ids.add(e.id);return {id:e.id,hex:e.hex,visible:e.visible};});
  let factions;
  if('factions' in value){if(!Array.isArray(value.factions)||value.factions.length>2)throw new Error('Invalid campaign factions');const seen=new Set();factions=value.factions.map(f=>{if(!f||Object.keys(f).length!==3||!['royal-guard','alliance'].includes(f.kind)||seen.has(f.kind)||!parseHexId(f.hex)||typeof f.visible!=='boolean')throw new Error('Invalid campaign faction');seen.add(f.kind);return {kind:f.kind,hex:f.hex,visible:f.visible};});}
  return {party:value.party,flags,enemies,...(factions?{factions}:{})};
}
export function projectPublicCampaignMap(value) { const m=sanitizeCampaignMap(value); return {party:m.party?{hex:m.party}:null,flags:['red','yellow','blue'].flatMap(color=>m.flags[color].hex&&m.flags[color].visible?[{color,hex:m.flags[color].hex}]:[]),enemies:m.enemies.filter(e=>e.visible).map(({hex})=>({hex})),...(m.factions?.some(f=>f.visible)?{factions:m.factions.filter(f=>f.visible).map(({kind,hex})=>({kind,hex}))}:{})}; }
