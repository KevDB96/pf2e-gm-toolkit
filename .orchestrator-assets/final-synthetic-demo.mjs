import { chromium } from 'file:///C:/Users/kevin/AppData/Local/nvm/v22.23.2/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';
import { createCanonicalCampaignFixture } from '../tests/fixtures/canonical-campaign.mjs';

const fixture = createCanonicalCampaignFixture();
const gm = fixture.gm;
const revealedCreature = gm.combat.combatants.find(c => c.id === 'creature-revealed');
if (revealedCreature) revealedCreature.publicImage = './assets/icons/library/creatures.png';
const seeded = {
  campaign: gm.campaign,
  party: { level: 4, size: 2, members: [] }, encounter: gm.encounter,
  combat: gm.combat, notes: { entries: gm.notes }, characters: { extra: gm.companionCharacters },
  companion: gm.roster, downtime: { records: gm.downtimeRecords },
  exploration: { elapsedMinutes: 0, activities: {}, timers: [], events: gm.explorationEvents },
  events: gm.events, session: { phase: 'combat', revision: gm.revision, recap: gm.recap },
  announcements: { items: gm.announcements }, player: gm.player,
  ui: { group: { run: 'combat', table: 'party' }, recent: [], pins: [] }
};

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await context.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));
const gmPage = await context.newPage();
const playerPage = await context.newPage();
const consoleErrors = [], pageErrors = [], failedRequests = [];
for (const page of [gmPage, playerPage]) {
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) failedRequests.push({ url: response.url(), status: response.status() }); });
}
await gmPage.addInitScript(state => localStorage.setItem('pf2e-gm-toolkit/v1', JSON.stringify(state)), seeded);
await playerPage.addInitScript(() => {
  window.__snapshots = [];
  const channel = new BroadcastChannel('pf2e-gm-toolkit/player-v1');
  channel.addEventListener('message', event => window.__snapshots.push(event.data));
});
const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });
const snapshot = () => playerPage.evaluate(() => window.__snapshots.at(-1));
const playerText = () => playerPage.locator('body').innerText();
await gmPage.goto('http://127.0.0.1:8001/#/combat', { waitUntil: 'domcontentloaded', timeout: 5000 });
await gmPage.waitForSelector('[data-session-phase="combat"]', { timeout: 5000 });
await playerPage.goto('http://127.0.0.1:8001/player.html');
await playerPage.waitForTimeout(1000);
await gmPage.screenshot({ path: '.orchestrator-assets/gm-combat-desktop.png', fullPage: true });
let current = await snapshot();
check('campaign and linked characters are public', current?.projection?.session?.characters?.map(c => c.name).join('|') === 'Aria Vale|Bram Stone');
check('combat round and revealed public creature', current?.projection?.session?.round === 3 && JSON.stringify(current).includes('Ashen Warden') && !JSON.stringify(current).includes('Invisible Vault Guardian'));
check('condition, recap, shared note, discovery, downtime, and announcement are public',
  JSON.stringify(current).includes('Frightened 1') && current.projection.session.recap.title === 'The watchtower stirs' &&
  current.projection.session.notes.some(note => note.title === 'Shared route') &&
  current.projection.session.events.some(event => event.description === 'A stairway descends beneath the road.') &&
  current.projection.session.events.some(event => event.resultText === 'The town remembers your help.') &&
  current.projection.session.announcements.some(item => item.message === 'Meet at the watchtower.'));
check('player DOM omits hidden creature', (await playerText()).includes('Ashen Warden') && !(await playerText()).includes('Vault Guardian'));
const serialized = JSON.stringify(current);
check('player projection contains no GM-private values', !/(Invisible Vault Guardian|greatsword \+19|electricity|"hp":|"ac":|"saves":|"attacks":|"weaknesses":|"resistances":|gmNotes|sourceId|internalSourceId)/i.test(serialized));

await gmPage.locator('[data-session-phase="exploration"]').click();
await playerPage.waitForFunction(() => window.__snapshots.at(-1)?.projection?.session?.phase === 'exploration');
check('GM phase switch reaches exploration', (await snapshot()).projection.session.phase === 'exploration');
await gmPage.screenshot({ path: '.orchestrator-assets/gm-exploration-desktop.png', fullPage: true });
await gmPage.locator('[data-session-phase="combat"]').click();
await gmPage.locator('[data-next]').click();
await playerPage.waitForTimeout(300);
check('initiative turn advances without a hidden public turn', (await snapshot()).projection.session.currentTurnId === null);

await gmPage.locator('[data-player-settings]').click();
await gmPage.locator('[data-player-reveal="combat-aria"]').uncheck();
await gmPage.locator('[data-player-save]').click();
await playerPage.waitForFunction(() => !window.__snapshots.at(-1)?.projection?.session?.actors?.some(actor => actor.name === 'Aria Vale'));
check('GM hide/reveal control hides Aria', !(await snapshot()).projection.session.actors.some(actor => actor.name === 'Aria Vale'));
await gmPage.locator('[data-player-settings]').click();
await gmPage.locator('[data-player-reveal="combat-aria"]').check();
await gmPage.locator('[data-player-save]').click();
await playerPage.waitForFunction(() => window.__snapshots.at(-1)?.projection?.session?.actors?.some(actor => actor.name === 'Aria Vale'));
check('GM hide/reveal control restores Aria', (await snapshot()).projection.session.actors.some(actor => actor.name === 'Aria Vale'));

for (const [width, height, label] of [[390, 844, 'mobile'], [768, 1024, 'tablet'], [1440, 1000, 'desktop']]) {
  await gmPage.setViewportSize({ width, height }); await playerPage.setViewportSize({ width, height }); await gmPage.waitForTimeout(50);
  const dimensions = await gmPage.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth }));
  const playerDimensions = await playerPage.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth }));
  check(`GM and Companion fit ${label} viewport`, dimensions.scrollWidth <= width && dimensions.bodyScrollWidth <= width && playerDimensions.scrollWidth <= width && playerDimensions.bodyScrollWidth <= width, JSON.stringify({ gm: dimensions, player: playerDimensions }));
  if (label === 'mobile') await gmPage.screenshot({ path: '.orchestrator-assets/gm-combat-mobile.png', fullPage: true });
}
console.log(JSON.stringify({ checks, consoleErrors, pageErrors, failedRequests }, null, 2));
await context.close(); await browser.close();
if (checks.some(check => !check.pass) || consoleErrors.length || pageErrors.length || failedRequests.length) process.exitCode = 1;
