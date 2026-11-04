// Step 1 + 2 end-to-end at phone size (390x844) against the LOCAL Auth + Firestore emulators (project demo-ccc).
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
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'emulators only');

// Admin SDK + the real Cloud Function logic, pointed at the emulators.
const require = createRequire(join(ROOT, 'functions', 'index.js'));
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { issueTempPassword } = require('./issue.js');
initializeApp({ projectId: 'demo-ccc' });
const adm = { auth: getAuth(), db: getFirestore(), FieldValue };

// Demo seed (made-up people). Same shapes as the Parish Portal.
const P = 'demo-ijaye', NO = 'CCC-IJY-ABK-MBR-001', NO_OTHER = 'CCC-LAG-IKJ-MBR-001', NO2 = 'CCC-IJY-ABK-MBR-002';
const { postBirthdays, lagosDate } = require('./birthdays.js');
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
// Another member's posts (one public, one members-only) + the daily birthday job.
const post = (o) => ({ kind: 'post', authorUid: 'uTunde', authorName: 'Tunde Example', photoPath: '', status: 'Visible', modVersion: 0, createdAt: FieldValue.serverTimestamp(), ...o });
await adm.db.doc('webWall/demoPublic').set(post({ text: 'Thanks to everyone who came for the harvest thanksgiving. God bless you all!', visibility: 'public' }));
await adm.db.doc('webWall/demoMembers').set(post({ text: 'Choir rehearsal moves to Saturday 4pm this week (members only notice).', visibility: 'members' }));
const bd = await postBirthdays(adm, new Date());
assert.equal(bd.created, 1);
assert.equal((await postBirthdays(adm, new Date())).created, 0, 'birthday job is idempotent');
const bpost = (await adm.db.collection('webWall').where('kind', '==', 'birthday').get()).docs[0].data();
assert.ok(bpost.text.startsWith('Halleluyah 🙌') && bpost.text.includes('Tunde Example'));
assert.ok(!/1975|0801|Sample Road/.test(JSON.stringify(bpost)), 'birthday post must not contain year, phone or address');
assert.equal(bpost.visibility, 'members');
console.log('birthday job ok');
await adm.auth.createUser({ uid: 'uIjAdmin', email: 'office@ijaye-demo.test', password: 'AdminDemo2026' });

// Function guards: other parish admin refused; another parish's member refused; unknown number refused.
await assert.rejects(issueTempPassword(adm, 'uLagAdmin', NO), /Only the Ijaye parish admin/);
await assert.rejects(issueTempPassword(adm, 'uIjAdmin', NO_OTHER), /No active Ijaye record/);
await assert.rejects(issueTempPassword(adm, 'uIjAdmin', 'CCC-IJY-ABK-MBR-999'), /No active Ijaye record/);
const { tempPassword } = await issueTempPassword(adm, 'uIjAdmin', NO);
assert.equal(tempPassword.length, 10);
// No password anywhere in Firestore.
const acc = (await adm.db.collection('webAccounts').get()).docs.map(d => JSON.stringify(d.data())).join();
assert.ok(!acc.includes(tempPassword), 'password must not be stored in Firestore');
console.log('function guards ok');

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
  assert.ok(await page.isHidden('#ytChannelBtn'));
  await shot('04-watch-placeholders');
  await nav('media');
  assert.equal(await page.locator('.media-card.off').count(), 4);
  await shot('05-media-placeholders');

  await nav('wall');
  await page.waitForSelector('[data-post="demoPublic"]');
  assert.equal(await page.locator('[data-post="demoMembers"]').count(), 0, 'members-only post hidden from visitors');
  assert.equal(await page.locator('.post-bday').count(), 0, 'birthday posts are members-only');
  assert.ok(await page.isHidden('#composer'), 'visitors cannot post');
  await page.click('[data-post="demoPublic"] summary');
  await page.fill('#vn_demoPublic', 'Mama Visitor'); await page.fill('#vc_demoPublic', 'Congratulations, we enjoyed the harvest!');
  await page.click('[data-post="demoPublic"] >> text=Send for approval');
  await page.waitForFunction(() => document.querySelector('#vm_demoPublic').textContent.includes('after the parish office approves'));
  await shot('06-wall-visitor-comment-pending');
  await page.reload(); await settle(); await nav('wall'); await page.waitForSelector('[data-post="demoPublic"]');
  assert.ok(!(await page.textContent('#wallFeed')).includes('we enjoyed the harvest'), 'pending comment not shown');

  // ---------- Member: step-1 login flow ----------
  await page.click('#headerSignIn');
  await page.fill('#memberNo', 'hello'); await page.fill('#password', 'x'); await page.click('#signinBtn');
  await page.waitForSelector('#signinError:not(.hidden)');
  await page.fill('#memberNo', NO.toLowerCase()); await page.fill('#password', 'wrong-password'); await page.click('#signinBtn');
  await page.waitForFunction(() => document.querySelector('#signinError').textContent.includes('not correct'));
  await page.fill('#password', tempPassword); await page.click('#signinBtn');
  await page.waitForSelector('#view-changepw.active');
  await page.fill('#newPw', 'short'); await page.fill('#newPw2', 'short'); await page.click('#changeBtn');
  await page.waitForSelector('#changeError:not(.hidden)');
  await page.fill('#newPw', 'MyNewPass2026'); await page.fill('#newPw2', 'MyNewPass2026'); await page.click('#changeBtn');
  await page.waitForSelector('#view-members.active');
  assert.equal(await page.textContent('#memberGreeting'), 'Halleluyah 🙌, Adunni Demo');

  // My duties: from the LATEST published revision (r2), future dates only, never the draft (r3 Sanitation).
  await page.waitForFunction(() => !document.querySelector('#myDuties').textContent.includes('Loading'));
  const duties = await page.textContent('#myDuties');
  assert.ok(duties.includes('Lesson Reader 1') && duties.includes('Prayer'), duties);
  assert.ok(!duties.includes('Sanitation'), 'draft roster must not show');
  assert.equal(await page.locator('#myDuties .duty-row').count(), 3, 'r2: 2 future rows Reader 1 + 1 Prayer');
  await page.waitForFunction(() => document.querySelector('#rosterView').textContent.includes('Version 2'));
  await shot('07-member-my-duties');
  await page.locator('#rosterView').scrollIntoViewIfNeeded(); await shot('08-member-month-roster');

  // Wall as member: sees members-only + birthday posts; posts with a photo (public), likes, comments.
  await nav('wall'); await page.waitForSelector('[data-post="demoMembers"]');
  assert.equal(await page.locator('.post-bday').count(), 1);
  assert.ok((await page.textContent('.post-bday')).includes('Halleluyah 🙌 Happy birthday to Tunde Example'));
  await shot('09-wall-member-birthday');
  await page.fill('#postText', 'Halleluyah! Thank you all for the prayers during my exams. I passed!');
  await page.setInputFiles('#photoInput', join(ROOT, 'assets', 'ccc-logo.png'));
  await page.waitForSelector('#photoPreviewBox:not(.hidden)');
  await page.check('#postPublic');
  await shot('10-wall-compose-with-photo');
  await page.click('#postBtn');
  await page.waitForFunction(() => document.querySelector('#wallFeed').textContent.includes('I passed!'));
  const mine = page.locator('article', { hasText: 'I passed!' });
  await mine.locator('img').waitFor();
  const myPostId = await mine.getAttribute('data-post');
  const saved = (await adm.db.doc('webWall/' + myPostId).get()).data();
  assert.equal(saved.authorName, 'Adunni Demo'); assert.equal(saved.visibility, 'public');
  assert.match(saved.photoPath, new RegExp(`^web/wall/[^/]+/${myPostId}/photo.jpg$`));
  await page.click('[data-post="demoMembers"] .like-btn');
  await page.waitForFunction(() => document.querySelector('[data-post="demoMembers"] .like-btn').textContent.includes('1'));
  await page.fill('#c_demoMembers', 'Noted, thank you.'); await page.click('[data-post="demoMembers"] >> text=Send');
  await page.waitForFunction(() => document.querySelector('[data-post="demoMembers"]').textContent.includes('Noted, thank you.'));
  await page.locator(`[data-post="${myPostId}"]`).scrollIntoViewIfNeeded();
  await shot('11-wall-member-posted-liked-commented');
  await page.click('#headerSignOut');

  // ---------- Parish office (Ijaye admin): moderation + settings ----------
  await page.click('#headerSignIn');
  await page.click('text=Parish office sign in');
  await page.fill('#adminEmail', 'office@ijaye-demo.test'); await page.fill('#adminPw', 'AdminDemo2026');
  await page.click('#adminSigninBtn');
  await page.waitForSelector('#view-admin.active');
  await page.waitForFunction(() => document.querySelector('#pendingList').textContent.includes('Mama Visitor'));
  assert.equal(await page.textContent('#pendingCount'), '1');
  await shot('12-admin-moderation-queue');
  await page.click('#pendingList >> text=Approve');
  await page.waitForFunction(() => document.querySelector('#pendingList').textContent.includes('Nothing waiting'));
  // Hide the members-only demo post; then show it again. Each action logged.
  await page.click(`#modPosts div:has-text("Choir rehearsal") >> text=Hide`);
  await page.waitForFunction(() => document.querySelector('#modPosts').textContent.includes('Show again'));
  await shot('13-admin-post-hidden');
  const log = (await adm.db.collection('webModLog').get()).docs.map(d => d.id).sort();
  assert.equal(log.length, 2, JSON.stringify(log));
  assert.ok(log.some(id => id.startsWith('cmt_')) && log.includes('post_demoMembers_1'));
  assert.ok((await adm.db.doc('webWall/demoMembers').get()).exists, 'hidden, not deleted');

  await page.click('#tabSettings');
  await page.fill('#s_ytChannel', 'https://www.youtube.com/channel/UCdemoDEMOdemoDEMOdemo12');
  await page.fill('#s_ytUrl', 'https://www.youtube.com/@ccc-ijaye-demo');
  await page.fill('#s_playlist', 'https://www.youtube.com/playlist?list=PLdemoDEMOdemoDEMO01');
  await page.fill('#s_past', 'https://youtu.be/AAAAAAAAAAA | Sunday Service (demo)\nhttps://www.youtube.com/watch?v=BBBBBBBBBBB | Mercy Day (demo)\nhttps://youtu.be/CCCCCCCCCCC | Power Day (demo)\nhttps://youtu.be/DDDDDDDDDDD | Harvest (demo)');
  await page.fill('#s_fb', 'javascript:alert(1)');
  await page.click('#settingsBtn');
  await page.waitForFunction(() => document.querySelector('#settingsMsg').textContent.includes('facebook'));
  await page.fill('#s_fb', 'https://www.facebook.com/ccc-ijaye-demo');
  await page.fill('#s_tt', 'https://www.tiktok.com/@ccc-ijaye-demo');
  await page.click('#settingsBtn');
  await page.waitForFunction(() => document.querySelector('#settingsMsg').textContent.startsWith('Saved'));
  await shot('14-admin-settings-saved', true);
  const home = (await adm.db.doc('webSite/home').get()).data();
  assert.equal(home.media.youtubeChannelId, 'UCdemoDEMOdemoDEMOdemo12'); assert.equal(home.media.pastVideos.length, 4);
  await page.click('#headerSignOut');

  // ---------- Visitor again: embeds use the saved links; approved comment visible; hidden post gone ----------
  await nav('watch');
  await page.waitForSelector('#livePlayer iframe');
  assert.ok((await page.getAttribute('#livePlayer iframe', 'src')).includes('live_stream?channel=UCdemoDEMOdemoDEMOdemo12'));
  assert.equal(await page.locator('#pastGrid .thumb').count(), 4);
  await page.waitForTimeout(500);
  await shot('15-watch-live-and-past');
  await page.click('#pastGrid button >> nth=1');
  await page.waitForFunction(() => document.querySelector('#livePlayer iframe').src.includes('BBBBBBBBBBB'));
  await page.locator('#playlistBox').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await shot('16-watch-playlist');
  await nav('media'); await page.waitForTimeout(500);
  assert.equal(await page.locator('.media-card.off').count(), 1, 'only Instagram still a placeholder');
  await shot('17-media-hub', true);
  await nav('wall');
  await page.waitForFunction(() => document.querySelector('#wallFeed').textContent.includes('we enjoyed the harvest'));
  assert.ok((await page.textContent('#wallFeed')).includes('I passed!'), 'public member post visible to visitors');
  await page.locator('article', { hasText: 'I passed!' }).locator('img').waitFor();
  await shot('18-wall-visitor-after-approval');

  // Admin password reset still forces a change (step 1).
  const again = await issueTempPassword(adm, 'uIjAdmin', NO);
  await page.click('#headerSignIn');
  await page.fill('#memberNo', NO); await page.fill('#password', again.tempPassword); await page.click('#signinBtn');
  await page.waitForSelector('#view-changepw.active');
  console.log('reset forces change again ok');

  assert.deepEqual(errors, []);
  console.log('E2E PASS');
} catch (e) {
  await shot('zz-failure', true); throw e;
} finally { await browser.close(); server.close(); }
