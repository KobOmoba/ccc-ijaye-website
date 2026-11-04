// Step 1 end-to-end at phone size (390x844) against the LOCAL Auth + Firestore emulators (project demo-ccc).
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

// Admin SDK + the real Cloud Function logic, pointed at the emulators.
const require = createRequire(join(ROOT, 'functions', 'index.js'));
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { issueTempPassword } = require('./issue.js');
initializeApp({ projectId: 'demo-ccc' });
const adm = { auth: getAuth(), db: getFirestore(), FieldValue };

// Demo seed (made-up people). Same shapes as the Parish Portal.
const P = 'demo-ijaye', NO = 'CCC-IJY-ABK-MBR-001', NO_OTHER = 'CCC-LAG-IKJ-MBR-001';
await adm.db.doc('users/uIjAdmin').set({ role: 'parish_admin', parishId: P });
await adm.db.doc('users/uLagAdmin').set({ role: 'parish_admin', parishId: 'demo-lagos' });
await adm.db.doc(`parishes/${P}`).set({ status: 'Approved', parishLetters: 'IJY', cityLetters: 'ABK' });
await adm.db.doc('parishes/demo-lagos').set({ status: 'Approved' });
await adm.db.doc(`parishes/${P}/members/${NO}`).set({ memberNo: NO, fullName: 'Adunni Demo', status: 'Active' });
await adm.db.doc(`parishes/demo-lagos/members/${NO_OTHER}`).set({ memberNo: NO_OTHER, fullName: 'Lagos Demo', status: 'Active' });
await adm.db.doc('webSite/config').set({ parishId: P });

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

try {
  await page.goto(APP); await page.waitForLoadState('networkidle');
  assert.ok((await page.textContent('body')).includes('Halleluyah 🙌'));
  assert.ok(!/good (morning|afternoon|evening)/i.test(await page.textContent('body')));
  await shot('01-home-top');
  await shot('02-home-full', true);

  await page.click('text=Member sign in');
  await page.fill('#memberNo', 'hello'); await page.fill('#password', 'x'); await page.click('#signinBtn');
  await page.waitForSelector('#signinError:not(.hidden)');
  await shot('03-signin-bad-number');

  await page.fill('#memberNo', NO.toLowerCase()); await page.fill('#password', 'wrong-password'); await page.click('#signinBtn');
  await page.waitForFunction(() => document.querySelector('#signinError').textContent.includes('not correct'));
  await shot('04-signin-wrong-password');

  await page.fill('#password', tempPassword); await page.click('#signinBtn');
  await page.waitForSelector('#view-changepw.active');
  await shot('05-first-login-change-password');
  await page.fill('#newPw', 'short'); await page.fill('#newPw2', 'short'); await page.click('#changeBtn');
  await page.waitForSelector('#changeError:not(.hidden)');
  await page.fill('#newPw', 'MyNewPass2026'); await page.fill('#newPw2', 'MyNewPass2026'); await page.click('#changeBtn');
  await page.waitForSelector('#view-members.active');
  assert.equal(await page.textContent('#memberGreeting'), 'Halleluyah 🙌, Adunni Demo');
  await shot('06-members-area');

  // Sign out; temp password no longer works, new one goes straight in.
  await page.click('#headerSignOut'); await page.click('text=Member sign in');
  await page.fill('#memberNo', NO); await page.fill('#password', tempPassword); await page.click('#signinBtn');
  await page.waitForFunction(() => document.querySelector('#signinError').textContent.includes('not correct'));
  await page.fill('#password', 'MyNewPass2026'); await page.click('#signinBtn');
  await page.waitForSelector('#view-members.active');
  await shot('07-second-login-no-forced-change');

  // Admin reset: forces a change again.
  await page.click('#headerSignOut');
  const again = await issueTempPassword(adm, 'uIjAdmin', NO);
  await page.click('text=Member sign in');
  await page.fill('#memberNo', NO); await page.fill('#password', again.tempPassword); await page.click('#signinBtn');
  await page.waitForSelector('#view-changepw.active');
  console.log('reset forces change again ok');

  assert.deepEqual(errors, []);
  console.log('E2E PASS');
} catch (e) {
  await shot('zz-failure', true); throw e;
} finally { await browser.close(); server.close(); }
