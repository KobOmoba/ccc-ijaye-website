// Step 1-3 end-to-end (FREE PLAN: no functions, no storage) at phone size (390x844) against the LOCAL Auth + Firestore emulators (project demo-ccc).
// Never touches the live project. Demo data only. Run: npm run test:e2e   (screenshots -> $SHOTS_DIR)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = process.env.SHOTS_DIR || join(ROOT, 'firestore', 'screenshots');
mkdirSync(SHOTS, { recursive: true });
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, 'emulators only');

// Admin SDK only to SEED demo data and to check results (the site itself uses the free-plan client code).
const require = createRequire(join(ROOT, 'functions', 'index.js'));
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
initializeApp({ projectId: 'demo-ccc' });
const adm = { auth: getAuth(), db: getFirestore(), FieldValue };

// Demo seed (made-up people). Same shapes as the Parish Portal.
const P = 'demo-ijaye', NO = 'CCC-IJY-ABK-MBR-001', NO_OTHER = 'CCC-LAG-IKJ-MBR-001', NO2 = 'CCC-IJY-ABK-MBR-002';
const { lagosDate } = require('./birthdays.js');
const today = lagosDate(), T = today.ymd, MONTH = T.slice(0, 7);
const plus = (n) => { const d = new Date(T + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
await adm.db.doc('users/uIjAdmin').set({ role: 'parish_admin', parishId: P });
await adm.db.doc('users/uLagAdmin').set({ role: 'parish_admin', parishId: 'demo-lagos' });
await adm.db.doc(`parishes/${P}`).set({ status: 'Approved', parishLetters: 'IJY', cityLetters: 'ABK' });
await adm.db.doc('parishes/demo-lagos').set({ status: 'Approved' });
await adm.db.doc(`parishes/${P}/members/${NO}`).set({ memberNo: NO, fullName: 'Adunni Demo', status: 'Active', dobDay: 3, dobMonth: 3, dobYear: 1980, phone: '08000000000', address: '1 Demo Street' });
await adm.db.doc(`parishes/${P}/members/${NO2}`).set({ memberNo: NO2, fullName: 'Tunde Example', status: 'Active', dobDay: today.day, dobMonth: today.month, dobYear: 1975, phone: '08011111111', address: '2 Sample Road' });
await adm.db.doc(`parishes/demo-lagos/members/${NO_OTHER}`).set({ memberNo: NO_OTHER, fullName: 'Lagos Demo', status: 'Active' });
await adm.db.doc('webSite/config').set({ parishId: P });
await adm.db.doc('webSite/home').set({ serviceTimes: [] });
// Portal Batch 17 data (demo): public info, this week's readings, PUBLISHED rosters (r2 replaces r1) and a draft r3.
await adm.db.doc(`publicInfo/${P}`).set({ parishName: 'Ijaye HQ (demo)', services: ['Sunday 10:00 Sunday Service (demo time)', 'Wednesday 09:00 Mercy Day (demo time)', 'Friday 09:00 Power Day (demo time)'],
  address: 'Ijaye, Abeokuta, Ogun State (demo address)', phone: '+234 800 000 0000', mapsUrl: 'https://maps.google.com/?q=Ijaye+Abeokuta', about: 'Demo text: the parish office will write a short welcome here.', updatedAt: T });
for (const [i, r] of [['Psalm 23; John 10:1-11', 'Sunday Service'], ['Isaiah 40:28-31; Matthew 11:28-30', 'Mercy Day']].entries())
  await adm.db.doc(`bibleReadings/${plus(i * 2)}`).set({ date: plus(i * 2), services: [{ service: r[1], readings: r[0] }], version: 1, updatedAt: T });
const duty = (d, no, name) => ({ duty: d, no, name, kind: 'member' });
const row = (date, extra = []) => ({ date, service: 'SUNDAY', lesson1: 'Psalm 23', lesson2: 'John 10:1-11', duties: [
  duty('Service Conductor', 'CCC-IJY-ABK-CLG-001', 'VEN. DEMO SHEPHERD'), duty('Lesson Reader 1', NO, 'SIS. ADUNNI DEMO'),
  duty('Lesson Reader 2', NO2, 'BRO. TUNDE EXAMPLE'), duty('Preacher', 'CCC-IJY-ABK-CLG-002', 'SNR. EVANG. SAMPLE'), ...extra] });
const roster = (rev, status, rows) => ({ month: MONTH, rev, status, rows, nos: [NO, NO2], version: 1, parishName: 'Ijaye HQ (demo)' });
await adm.db.doc(`parishes/${P}/rosters/${MONTH}_r1`).set(roster(1, 'Published', [row(plus(1))]));
await adm.db.doc(`parishes/${P}/rosters/${MONTH}_r2`).set(roster(2, 'Published', [row(plus(-2)), row(plus(3), [duty('Prayer', NO, 'SIS. ADUNNI DEMO')]), row(plus(10))]));
await adm.db.doc(`parishes/${P}/rosters/${MONTH}_r3`).set(roster(3, 'Draft', [row(plus(3), [duty('Sanitation', NO, 'SIS. ADUNNI DEMO')])]));
// Another member's stories (made earlier today) + a birthdays list entry for today (name + day + month only).
const ago = (min) => new Date(Date.now() - min * 60000);
await adm.db.doc('webAccounts/uTunde').set({ memberNo: NO2, parishId: P, displayName: 'Tunde Example', status: 'Active', mustChangePassword: false });
const st = (o) => ({ kind: 'text', authorUid: 'uTunde', authorName: 'Tunde Example', bg: 3, hasPhoto: false, status: 'Visible', modVersion: 0, ...o });
await adm.db.doc('webStories/demoPublic').set(st({ text: 'Thanks to everyone who came for the harvest thanksgiving. God bless you all! 🙏', visibility: 'public', createdAt: ago(120) }));
await adm.db.doc('webStories/demoMembers').set(st({ text: 'Choir rehearsal moves to Saturday 4pm this week.', bg: 2, visibility: 'members', createdAt: ago(60) }));
await adm.db.doc('webStories/demoOld').set(st({ text: 'Yesterday story (expired)', visibility: 'public', createdAt: ago(60 * 26) }));
await adm.db.doc('webAccounts/uBisi').set({ memberNo: 'CCC-IJY-ABK-MBR-005', parishId: P, displayName: 'Bisi Sample', status: 'Active', mustChangePassword: false });
await adm.db.doc('webStories/demoBisi').set(st({ authorUid: 'uBisi', authorName: 'Bisi Sample', text: 'Mercy Day was powerful. Halleluyah!', bg: 5, visibility: 'members', createdAt: ago(30) }));
await adm.db.doc('webBirthdays/bTunde').set({ name: 'Tunde Example', day: today.day, month: today.month });
await adm.auth.createUser({ uid: 'uIjAdmin', email: 'office@ijaye-demo.test', password: 'AdminDemo2026' });

// Static server for the site.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  if (path.startsWith('/functions') || path.startsWith('/firestore')) { res.writeHead(404); return res.end(); }
  let body; try { body = readFileSync(join(ROOT, path)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(path)] || 'text/plain' }); res.end(body);
}).listen(5077, '127.0.0.1');
const APP = 'http://127.0.0.1:5077/?emulator=1';

const launch = {};
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const NM = join(ROOT, 'firestore', 'node_modules');
await page.route('https://cdn.tailwindcss.com/**', r => r.fulfill({ path: join(NM, '@tailwindcss/browser/dist/index.global.js'), contentType: 'text/javascript' }));
await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ path: join(NM, 'firebase', r.request().url().split('/').pop()), contentType: 'text/javascript' }));
await page.route('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/**', r => {
  const rel = new URL(r.request().url()).pathname.split('/6.4.0/')[1];
  return r.fulfill({ path: join(NM, '@fortawesome/fontawesome-free', rel) });
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.log('BROWSER', m.text().slice(0, 300)); });
const shot = (n, full = false) => page.screenshot({ path: join(SHOTS, n + '.png'), fullPage: full });

// Outside services are stubbed (offline test): YouTube / Facebook iframes and thumbnails.
const stub = (label) => `<html><head><meta charset="utf-8"></head><body style="margin:0;background:#111;color:#fff;font:600 14px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">${label}<br>(stub in test)</body></html>`;
await page.route(/https:\/\/www\.youtube\.com\/embed\/.*/, r => r.fulfill({ contentType: 'text/html', body: stub('▶ YouTube player<br>' + new URL(r.request().url()).pathname.split('/').pop()) }));
await page.route(/https:\/\/www\.facebook\.com\/plugins\/.*/, r => r.fulfill({ contentType: 'text/html', body: stub('Facebook page plugin') }));
await page.route(/https:\/\/i\.ytimg\.com\/.*/, r => r.fulfill({ contentType: 'image/svg+xml',
  body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#0b2c63"/><text x="240" y="145" fill="#e9c94a" font-size="28" text-anchor="middle" font-family="sans-serif">Service recording</text></svg>' }));
page.on('dialog', d => d.accept());
const nav = (n) => page.click(`.bottom-nav [data-nav="${n}"]`);
const settle = () => page.waitForLoadState('load');

try {
  // ---------- Visitor ----------
  await page.goto(APP); await settle();
  await page.waitForFunction(() => document.querySelector('#readingsList').textContent.includes('Psalm 23'));
  const body = await page.textContent('body');
  assert.ok(body.includes('Halleluyah 🙌') && body.includes('Sunday 10:00 Sunday Service (demo time)') && body.includes('(demo address)'));
  assert.ok(!/good (morning|afternoon|evening)/i.test(body));
  assert.equal(await page.getAttribute('#callBtn', 'href'), 'tel:+2348000000000');
  await shot('01-home-top');
  await page.locator('#readings').scrollIntoViewIfNeeded(); await shot('02-home-info-readings');
  await shot('03-home-full', true);

  await nav('watch'); await settle();
  assert.ok((await page.textContent('#livePlayer')).includes('Live service will show here'));
  assert.ok(await page.isVisible('#ytChannelBtn'), 'channel handle link works before the UC id is known');
  await shot('04-watch-live-waiting-for-channel-id');

  // ---------- Visitor: stories ----------
  await nav('wall');
  await page.waitForSelector('[data-tile="demoPublic"]');
  assert.equal(await page.locator('#storyRow .story-av').count(), 1, 'visitor sees only the public story group');
  assert.ok(!(await page.textContent('#view-wall')).includes('expired'), '24h old story not shown');
  await shot('06-stories-visitor');
  await page.click('#storyRow .story-av');
  await page.waitForSelector('#storyViewer:not(.hidden) .sv-text');
  await page.click('#svActions >> text=Comments');
  await page.fill('#vName', 'Mama Visitor'); await page.fill('#vText', 'Congratulations, we enjoyed the harvest!');
  await page.click('#vSend');
  await page.waitForFunction(() => document.querySelector('#vMsg').textContent.includes('after the parish office approves'));
  await shot('07-story-visitor-comment-pending');
  await page.click('#storySheet button[aria-label="Close"]'); await page.click('.sv-top .sv-x');

  // ---------- Parish office: issue a temp password (FREE PLAN, secondary app), birthdays list ----------
  await page.click('#headerSignIn');
  await page.click('text=Parish office sign in');
  await page.fill('#adminEmail', 'office@ijaye-demo.test'); await page.fill('#adminPw', 'AdminDemo2026');
  await page.click('#adminSigninBtn');
  await page.waitForSelector('#view-admin.active');
  await page.click('#tabLogins');
  await page.fill('#issueNo', NO_OTHER); await page.click('#issueBtn');
  await page.waitForFunction(() => document.querySelector('#issueMsg').textContent.includes('No active Ijaye record'));
  await page.fill('#issueNo', NO.toLowerCase()); await page.click('#issueBtn');
  await page.waitForSelector('#issueResult:not(.hidden)');
  const tempPassword = (await page.textContent('#tempPw')).trim();
  assert.equal(tempPassword.length, 10);
  assert.ok(await page.isVisible('#view-admin.active'), 'admin still signed in after issuing (secondary app)');
  await shot('08-office-issue-temp-password');
  const accs = (await adm.db.collection('webAccounts').where('memberNo', '==', NO).get()).docs;
  assert.equal(accs.length, 1); assert.equal(accs[0].data().mustChangePassword, true);
  assert.ok(!JSON.stringify(accs.map(d => d.data())).includes(tempPassword), 'password never stored in Firestore');
  assert.ok((await adm.db.doc('webAudit/issue_' + accs[0].id).get()).exists, 'audit entry');
  await page.click('#tabBdays');
  await page.waitForFunction(() => document.querySelector('#bList').textContent.includes('Tunde Example'));
  await shot('09-office-birthdays-list');
  await page.click('#headerSignOut');

  // ---------- Member: login flow ----------
  await page.click('#headerSignIn');
  await page.fill('#memberNo', 'hello'); await page.fill('#password', 'x'); await page.click('#signinBtn');
  await page.waitForSelector('#signinError:not(.hidden)');
  await page.fill('#memberNo', NO.toLowerCase()); await page.fill('#password', 'wrong-password'); await page.click('#signinBtn');
  await page.waitForFunction(() => document.querySelector('#signinError').textContent.includes('not correct'));
  await page.fill('#password', tempPassword); await page.click('#signinBtn');
  await page.waitForSelector('#view-changepw.active');
  await page.fill('#newPw', 'MyNewPass2026'); await page.fill('#newPw2', 'MyNewPass2026'); await page.click('#changeBtn');
  await page.waitForSelector('#view-members.active');
  assert.equal(await page.textContent('#memberGreeting'), 'Halleluyah 🙌, Adunni Demo');
  await page.waitForFunction(() => document.querySelector('#rosterView').textContent.includes('Version 2'));
  assert.ok(!(await page.textContent('#myDuties')).includes('Sanitation'), 'draft roster must not show');

  // Stories as member: birthday story made automatically (once), row with rings.
  await nav('wall');
  await page.waitForSelector('#storyRow [data-group="b_bTunde"]');
  const bdays = (await adm.db.collection('webStories').where('kind', '==', 'birthday').get()).docs;
  assert.equal(bdays.length, 1);
  assert.equal(bdays[0].data().text, 'Halleluyah 🙌, happy birthday Tunde Example');
  await page.reload(); await settle(); await page.waitForSelector('#view-members.active'); await nav('wall'); await page.waitForSelector('#storyRow [data-group="b_bTunde"]');
  assert.equal((await adm.db.collection('webStories').where('kind', '==', 'birthday').get()).size, 1, 'no duplicate birthday story');
  assert.equal(await page.locator('#storyRow .ring.new').count(), 3, 'birthday + Tunde + Bisi unseen');
  await shot('10-stories-row-member');
  // Viewer: open birthday, pause on hold, tap through
  await page.click('#storyRow [data-group="b_bTunde"]');
  await page.waitForSelector('#storyViewer:not(.hidden) .sv-text.bday');
  await page.waitForTimeout(1200);
  await shot('11-viewer-birthday');
  await page.click('#svTap', { position: { x: 330, y: 300 } });   // next -> Tunde (group of 2)
  await page.waitForFunction(() => document.querySelector('#svWho').textContent.includes('Tunde'));
  const box = await page.locator('#svTap').boundingBox();
  await page.mouse.move(200, 400); await page.mouse.down(); await page.waitForTimeout(1500);
  const w1 = await page.evaluate(() => document.querySelector('#svBars .bar i').style.width);
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => document.querySelector('#svBars .bar i').style.width), w1, 'hold pauses');
  await page.mouse.up();
  await page.click('#svActions >> text=🙏');
  await page.waitForSelector('#svActions .sv-emoji.on');
  await page.waitForTimeout(700);
  await shot('12-viewer-text-story-reaction');
  await page.click('#svActions .sv-chip');
  await page.fill('#cText', 'Amen! See you on Saturday.'); await page.click('#sheetBody >> text=Send');
  await page.waitForFunction(() => document.querySelector('#sheetBody').textContent.includes('See you on Saturday'));
  await shot('13-viewer-comments-sheet');
  await page.click('#storySheet button[aria-label="Close"]');
  await page.click('.sv-top .sv-x');
  assert.ok((await adm.db.doc(`webStories/demoPublic/views/${accs[0].id}`).get()).exists, 'view recorded');

  // New photo story (compressed on the phone) + a text story
  await page.click('#storyRow button[aria-label="Add a story"]');
  await page.fill('#cmpText', 'Halleluyah! I passed my exams. Thank you all for the prayers 🙌');
  await page.click('#cmpSwatches .swatch >> nth=2');
  await shot('14-composer-text');
  await page.check('#cmpPublic');
  await page.click('#cmpShare');
  await page.waitForSelector('#composer.hidden', { state: 'attached' });
  await page.click('#storyRow button[aria-label="Add a story"]');
  await page.click('#cmpTabPhoto');
  await page.setInputFiles('#photoInput', join(ROOT, 'assets', 'ccc-logo.png'));
  await page.waitForSelector('#cmpPreview:not(.hidden)');
  await page.fill('#cmpCaption', 'Our beautiful church logo');
  await shot('15-composer-photo');
  await page.click('#cmpShare');
  await page.waitForSelector('#composer.hidden', { state: 'attached' });
  const mine = (await adm.db.collection('webStories').where('authorUid', '==', accs[0].id).get()).docs.map(d => ({ id: d.id, ...d.data() }));
  assert.equal(mine.length, 2);
  const ph = mine.find(m => m.hasPhoto);
  const data = (await adm.db.doc(`webStories/${ph.id}/photo/main`).get()).data().data;
  assert.ok(data.startsWith('data:image/jpeg;base64,') && data.length <= 200000, 'compressed JPEG <= ~150KB');
  await page.click('#storyRow [data-group="' + accs[0].id + '"]');
  await page.waitForSelector('#svImg[src^="data:image/jpeg"], .sv-text');
  await page.waitForTimeout(600);
  await shot('16-viewer-own-story');
  await page.click('.sv-top .sv-x');
  await page.click('#headerSignOut');

  // Tunde (the other member) views my story -> I see "Seen by 1"
  await adm.db.doc(`webStories/${ph.id}/views/uTunde`).set({ name: 'Tunde Example', at: new Date() });
  await page.click('#headerSignIn');
  await page.fill('#memberNo', NO); await page.fill('#password', 'MyNewPass2026'); await page.click('#signinBtn');
  await page.waitForSelector('#view-members.active');
  await nav('wall');
  await page.click('#storyRow [data-group="' + accs[0].id + '"]');
  await page.waitForSelector('#storyViewer:not(.hidden) #svWho b');
  if (!(await page.locator('#svImg').count())) await page.click('#svTap', { position: { x: 330, y: 300 } });
  await page.waitForSelector('#svImg');
  await page.click('#svActions >> text=Seen by');
  await page.waitForFunction(() => document.querySelector('#sheetBody').textContent.includes('Tunde Example'));
  await shot('17-viewer-seen-by');
  await page.click('#storySheet button[aria-label="Close"]'); await page.click('.sv-top .sv-x');
  await page.click('#headerSignOut');

  // ---------- Parish office: approve visitor comment, hide a story, reset = new login version ----------
  await page.click('#headerSignIn');
  await page.click('text=Parish office sign in');
  await page.fill('#adminEmail', 'office@ijaye-demo.test'); await page.fill('#adminPw', 'AdminDemo2026');
  await page.click('#adminSigninBtn');
  await page.waitForSelector('#view-admin.active');
  await page.waitForFunction(() => document.querySelector('#pendingList').textContent.includes('Mama Visitor'));
  await shot('18-office-moderation');
  await page.click('#pendingList >> text=Approve');
  await page.waitForFunction(() => document.querySelector('#pendingList').textContent.includes('Nothing waiting'));
  await page.click(`#modPosts div:has-text("Choir rehearsal") >> text=Hide`);
  await page.waitForFunction(() => document.querySelector('#modPosts').textContent.includes('Show again'));
  assert.ok((await adm.db.doc('webStories/demoMembers').get()).exists, 'hidden, not deleted');
  assert.ok((await adm.db.doc('webStories/demoOld').get()).exists, 'expired story kept');
  await page.click('#tabLogins');
  await page.fill('#issueNo', NO); await page.click('#issueBtn');
  await page.waitForSelector('#issueResult:not(.hidden)');
  const again = (await page.textContent('#tempPw')).trim();
  assert.equal((await adm.db.doc('webLogin/' + NO).get()).data().v, 2);
  assert.equal((await adm.db.doc('webAccounts/' + accs[0].id).get()).data().status, 'Replaced');
  await page.click('#headerSignOut');
  // old password no longer works; new temp password forces a change
  await page.click('#headerSignIn');
  await page.fill('#memberNo', NO); await page.fill('#password', 'MyNewPass2026'); await page.click('#signinBtn');
  await page.waitForFunction(() => document.querySelector('#signinError').textContent.includes('not correct'));
  await page.fill('#password', again); await page.click('#signinBtn');
  await page.waitForSelector('#view-changepw.active');
  console.log('reset (new login version) ok');
  await page.evaluate(() => auth.signOut());

  // Media hub with the church's real accounts as defaults
  await nav('media'); await page.waitForTimeout(400);
  const hub = await page.textContent('#mediaHub');
  assert.ok(hub.includes('CCC Ijaye Archdiocese'));
  assert.equal(await page.locator('#mediaHub a[href="https://www.tiktok.com/@celeijayeabkta_ng"]').count(), 1);
  assert.equal(await page.locator('#mediaHub a[href="https://www.youtube.com/@cccijayearchdiocese"]').count(), 1);
  assert.equal(await page.locator('#mediaHub a[href="https://www.facebook.com/cccijayearchdiocese"]').count(), 1);
  assert.equal(await page.locator('.media-card.off').count(), 1, 'only Instagram still a placeholder');
  await shot('19-media-hub-defaults', true);

  assert.deepEqual(errors, []);
  console.log('E2E PASS');
} catch (e) {
  await shot('zz-failure', true); throw e;
} finally { await browser.close(); server.close(); }
