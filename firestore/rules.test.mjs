// Website rules tests. Firestore EMULATOR only (demo project, never live).
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';

let env;
const ctx = (uid) => env.authenticatedContext(uid).firestore();
const as = {
  visitor: () => env.unauthenticatedContext().firestore(),
  member: () => ctx('uMem'),          // website member (no users doc)
  other: () => ctx('uOther'),         // another website member
  ijayeAdmin: () => ctx('uIj'),
  otherAdmin: () => ctx('uOt'),       // admin of a different parish
  superA: () => ctx('uSuper'),
};
const acct = (extra = {}) => ({ memberNo: 'CCC-IJY-ABK-MBR-001', parishId: 'ijaye', displayName: 'Demo Member',
  status: 'Active', mustChangePassword: true, ...extra });

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-ccc',
    firestore: { rules: readFileSync(new URL('./website.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    await setDoc(doc(d, 'users/uIj'), { role: 'parish_admin', parishId: 'ijaye' });
    await setDoc(doc(d, 'users/uOt'), { role: 'parish_admin', parishId: 'other' });
    await setDoc(doc(d, 'users/uSuper'), { role: 'super_admin' });
    await setDoc(doc(d, 'parishes/ijaye'), { status: 'Approved' });
    await setDoc(doc(d, 'parishes/other'), { status: 'Approved' });
    await setDoc(doc(d, 'parishes/ijaye/members/CCC-IJY-ABK-MBR-001'), { fullName: 'Demo Member', status: 'Active' });
    await setDoc(doc(d, 'webSite/config'), { parishId: 'ijaye' });
    await setDoc(doc(d, 'webSite/home'), { serviceTimes: [] });
    await setDoc(doc(d, 'webAccounts/uMem'), acct());
    await setDoc(doc(d, 'webAccounts/uOther'), acct({ memberNo: 'CCC-IJY-ABK-MBR-002' }));
    await setDoc(doc(d, 'webAudit/a1'), { action: 'issueTempPassword' });
  });
});

test('visitors can read the public home content but not write it', async () => {
  await assertSucceeds(getDoc(doc(as.visitor(), 'webSite/home')));
  await assertFails(setDoc(doc(as.visitor(), 'webSite/home'), { serviceTimes: [] }));
  await assertFails(setDoc(doc(as.member(), 'webSite/home'), { serviceTimes: [] }));
});

test('only the Ijaye admin (or super admin) edits home content, with valid fields', async () => {
  await assertSucceeds(setDoc(doc(as.ijayeAdmin(), 'webSite/home'), { serviceTimes: [{ name: 'Sunday', time: '10:00' }] }));
  await assertSucceeds(setDoc(doc(as.superA(), 'webSite/home'), { serviceTimes: [] }));
  await assertFails(setDoc(doc(as.otherAdmin(), 'webSite/home'), { serviceTimes: [] }));
  await assertFails(setDoc(doc(as.ijayeAdmin(), 'webSite/home'), { serviceTimes: [], script: '<x>' }));
});

test('only super admin sets which parish is Ijaye', async () => {
  await assertSucceeds(setDoc(doc(as.superA(), 'webSite/config'), { parishId: 'ijaye' }));
  await assertFails(setDoc(doc(as.ijayeAdmin(), 'webSite/config'), { parishId: 'other' }));
  await assertSucceeds(getDoc(doc(as.visitor(), 'webSite/config')));   // parish id only, public since step 2
});

test('a member reads only their own account', async () => {
  await assertSucceeds(getDoc(doc(as.member(), 'webAccounts/uMem')));
  await assertFails(getDoc(doc(as.member(), 'webAccounts/uOther')));
  await assertFails(getDoc(doc(as.visitor(), 'webAccounts/uMem')));
  await assertSucceeds(getDoc(doc(as.ijayeAdmin(), 'webAccounts/uMem')));
  await assertFails(getDoc(doc(as.otherAdmin(), 'webAccounts/uMem')));
});

// ======================= STEP 3: FREE PLAN logins (no Cloud Function) =======================
const EMAIL = 'ccc-ijy-abk-mbr-001@members.ijaye.invalid';
const as2 = (uid, email) => env.authenticatedContext(uid, { email }).firestore();
const newAcct = (o = {}) => ({ memberNo: 'CCC-IJY-ABK-MBR-001', parishId: 'ijaye', displayName: 'Demo Member', status: 'Active',
  mustChangePassword: true, v: 1, issuedBy: 'uIj', issuedAt: serverTimestamp(), ...o });
const audit = (uid, o = {}) => ({ action: 'issueTempPassword', memberNo: 'CCC-IJY-ABK-MBR-001', uid, v: 1, by: 'uIj', at: serverTimestamp(), ...o });
async function adminIssue(db, uid, acc = {}, aud = {}) {
  const b = writeBatch(db);
  b.set(doc(db, 'webAccounts/' + uid), newAcct(acc)); b.set(doc(db, 'webAudit/issue_' + uid), audit(uid, aud));
  return b.commit();
}

test('claims: only the Auth user whose email IS that number (and version) can claim it', async () => {
  await assertSucceeds(setDoc(doc(as2('uN1', EMAIL), 'webClaims/uN1'), { memberNo: 'CCC-IJY-ABK-MBR-001', v: 1 }));
  await assertSucceeds(setDoc(doc(as2('uN2', 'ccc-ijy-abk-mbr-001.v2@members.ijaye.invalid'), 'webClaims/uN2'), { memberNo: 'CCC-IJY-ABK-MBR-001', v: 2 }));
  await assertFails(setDoc(doc(as2('uN3', 'ccc-ijy-abk-mbr-001.v2@members.ijaye.invalid'), 'webClaims/uN3'), { memberNo: 'CCC-IJY-ABK-MBR-001', v: 1 }));
  await assertFails(setDoc(doc(as2('uN4', 'someone@gmail.com'), 'webClaims/uN4'), { memberNo: 'CCC-IJY-ABK-MBR-001', v: 1 }));
  await assertFails(setDoc(doc(as2('uN5', EMAIL), 'webClaims/uOther5'), { memberNo: 'CCC-IJY-ABK-MBR-001', v: 1 }));
  await assertFails(setDoc(doc(as2('uN1', EMAIL), 'webClaims/uN1'), { memberNo: 'CCC-IJY-ABK-MBR-001', v: 1 }));   // no overwrite
});

test('accounts: Ijaye admin issues only for a claimed, Active Ijaye record, with audit, name from the record', async () => {
  await setDoc(doc(as2('uN1', EMAIL), 'webClaims/uN1'), { memberNo: 'CCC-IJY-ABK-MBR-001', v: 1 });
  // a self-made Auth user with a claim cannot make its own account; members, other admins neither
  await assertFails(adminIssue(as2('uN1', EMAIL), 'uN1', { issuedBy: 'uN1' }, { by: 'uN1' }));
  await assertFails(adminIssue(as.otherAdmin(), 'uN1', { issuedBy: 'uOt' }, { by: 'uOt' }));
  await assertFails(adminIssue(as.ijayeAdmin(), 'uN1', { displayName: 'Bishop Fake' }));          // name must match record
  await assertFails(adminIssue(as.ijayeAdmin(), 'uN1', { mustChangePassword: false }));
  await assertFails(adminIssue(as.ijayeAdmin(), 'uNoClaim'));                                     // no claim
  await assertFails(setDoc(doc(as.ijayeAdmin(), 'webAccounts/uN1'), newAcct()));                // without audit
  await assertFails(adminIssue(as.ijayeAdmin(), 'uN1', { memberNo: 'CCC-IJY-ABK-MBR-002' }, { memberNo: 'CCC-IJY-ABK-MBR-002' }));  // claim mismatch
  await assertSucceeds(adminIssue(as.ijayeAdmin(), 'uN1'));
  await assertFails(deleteDoc(doc(as.ijayeAdmin(), 'webAccounts/uN1')));
});

test('accounts: inactive record refused; old login retired with audit; webLogin points at an Active account', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'parishes/ijaye/members/CCC-IJY-ABK-MBR-001'), { fullName: 'Demo Member', status: 'Left' }));
  await setDoc(doc(as2('uN1', EMAIL), 'webClaims/uN1'), { memberNo: 'CCC-IJY-ABK-MBR-001', v: 1 });
  await assertFails(adminIssue(as.ijayeAdmin(), 'uN1'));
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'parishes/ijaye/members/CCC-IJY-ABK-MBR-001'), { fullName: 'Demo Member', status: 'Active' }));
  // replace uMem (v1) by uN2 (v2)
  await setDoc(doc(as2('uN2', 'ccc-ijy-abk-mbr-001.v2@members.ijaye.invalid'), 'webClaims/uN2'), { memberNo: 'CCC-IJY-ABK-MBR-001', v: 2 });
  const d = as.ijayeAdmin(), b = writeBatch(d);
  b.set(doc(d, 'webAccounts/uN2'), newAcct({ v: 2 })); b.set(doc(d, 'webAudit/issue_uN2'), audit('uN2', { v: 2 }));
  b.update(doc(d, 'webAccounts/uMem'), { status: 'Replaced', statusBy: 'uIj', statusAt: serverTimestamp() });
  b.set(doc(d, 'webAudit/replaced_uMem'), audit('uMem', { action: 'replaced' }));
  b.set(doc(d, 'webLogin/CCC-IJY-ABK-MBR-001'), { v: 2, uid: 'uN2', updatedAt: serverTimestamp() });
  await assertSucceeds(b.commit());
  await assertSucceeds(getDoc(doc(as.visitor(), 'webLogin/CCC-IJY-ABK-MBR-001')));      // sign-in page reads it
  await assertFails(getDocs(collection(as.visitor(), 'webLogin')));                       // but cannot list numbers
  await assertFails(setDoc(doc(as.ijayeAdmin(), 'webLogin/CCC-IJY-ABK-MBR-001'), { v: 1, uid: 'uMem', updatedAt: serverTimestamp() }));  // retired
  await assertFails(updateDoc(doc(as.ijayeAdmin(), 'webAccounts/uOther'), { status: 'Disabled', statusBy: 'uIj', statusAt: serverTimestamp() })); // no audit
  await assertFails(updateDoc(doc(ctx('uOther'), 'webAccounts/uOther'), { status: 'Active' }));
});

test('audit log: admins read; only the Ijaye admin appends well-formed entries; nobody edits', async () => {
  await assertSucceeds(getDoc(doc(as.ijayeAdmin(), 'webAudit/a1')));
  await assertFails(getDoc(doc(as.member(), 'webAudit/a1')));
  await assertFails(addDoc(collection(as.ijayeAdmin(), 'webAudit'), { action: 'x' }));
  await assertFails(setDoc(doc(as.member(), 'webAudit/issue_uZ'), audit('uZ', { by: 'uMem' })));
  await assertFails(updateDoc(doc(as.ijayeAdmin(), 'webAudit/a1'), { action: 'y' }));
});

test('member can clear mustChangePassword once, and nothing else', async () => {
  await assertFails(updateDoc(doc(as.member(), 'webAccounts/uMem'), { mustChangePassword: false, memberNo: 'CCC-IJY-ABK-MBR-009', passwordChangedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as.member(), 'webAccounts/uMem'), { status: 'Active', displayName: 'Bishop' }));
  await assertFails(updateDoc(doc(as.other(), 'webAccounts/uMem'), { mustChangePassword: false, passwordChangedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as.member(), 'webAccounts/uMem'), { mustChangePassword: false, passwordChangedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as.member(), 'webAccounts/uMem'), { mustChangePassword: true }));
});

test('a disabled account cannot clear its flag', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'webAccounts/uMem'), acct({ status: 'Disabled' })));
  await assertFails(updateDoc(doc(as.member(), 'webAccounts/uMem'), { mustChangePassword: false, passwordChangedAt: serverTimestamp() }));
});

test('website members cannot read Portal member records or users', async () => {
  await assertFails(getDoc(doc(as.member(), 'parishes/ijaye/members/CCC-IJY-ABK-MBR-001')));
  await assertSucceeds(getDoc(doc(as.ijayeAdmin(), 'parishes/ijaye/members/CCC-IJY-ABK-MBR-001')));   // Portal rule copy
  await assertFails(getDoc(doc(as.member(), 'users/uIj')));
});

// ======================= STEP 2: media settings, rosters, wall, comments, moderation =======================
async function seedWall() {
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    await setDoc(doc(d, 'webAccounts/uMem'), acct({ mustChangePassword: false }));
    await setDoc(doc(d, 'webAccounts/uOld'), acct({ memberNo: 'CCC-IJY-ABK-MBR-003', mustChangePassword: false, status: 'Disabled' }));
    await setDoc(doc(d, 'webAccounts/uLag'), acct({ memberNo: 'CCC-LAG-IKJ-MBR-001', parishId: 'other', mustChangePassword: false }));
    const st = (o) => ({ kind: 'text', authorUid: 'uMem', authorName: 'Demo Member', text: 'Hi', bg: 1, hasPhoto: false, visibility: 'members', status: 'Visible', modVersion: 0, createdAt: new Date(), ...o });
    await setDoc(doc(d, 'webStories/pMembers'), st());
    await setDoc(doc(d, 'webStories/pPublic'), st({ visibility: 'public' }));
    await setDoc(doc(d, 'webStories/pHidden'), st({ visibility: 'public', status: 'Hidden', modVersion: 1 }));
    await setDoc(doc(d, 'webStories/pOther'), st({ authorUid: 'uMem2', authorName: 'Second Member' }));
    await setDoc(doc(d, 'webAccounts/uMem2'), acct({ memberNo: 'CCC-IJY-ABK-MBR-004', displayName: 'Second Member', mustChangePassword: false }));
    await setDoc(doc(d, 'webBirthdays/b1'), { name: 'Tunde Example', day: LAGOS.d, month: LAGOS.m });
    await setDoc(doc(d, 'webBirthdays/b2'), { name: 'Not Today', day: LAGOS.d === 1 ? 2 : 1, month: LAGOS.m });
    await setDoc(doc(d, 'webComments/cPending'), { storyId: 'pPublic', storyPublic: true, authorUid: '', authorName: 'Visitor', text: 'God bless', visitor: true, status: 'Pending', modVersion: 0, createdAt: new Date() });
    await setDoc(doc(d, 'webComments/cOk'), { storyId: 'pPublic', storyPublic: true, authorUid: 'uMem', authorName: 'Demo Member', text: 'Amen', visitor: false, status: 'Visible', modVersion: 0, createdAt: new Date() });
    await setDoc(doc(d, 'webComments/cMem'), { storyId: 'pMembers', storyPublic: false, authorUid: 'uMem', authorName: 'Demo Member', text: 'Amen', visitor: false, status: 'Visible', modVersion: 0, createdAt: new Date() });
    const roster = (o) => ({ month: '2026-11', rev: 1, status: 'Published', rows: [], nos: [], ...o });
    await setDoc(doc(d, 'parishes/ijaye/rosters/2026-11_r1'), roster());
    await setDoc(doc(d, 'parishes/ijaye/rosters/2026-11_r2'), roster({ rev: 2, status: 'Draft' }));
    await setDoc(doc(d, 'parishes/other/rosters/2026-11_r1'), roster());
  });
}
const ctxM = () => ctx('uMem');
const LAGOS = (() => { const t = new Date(Date.now() + 3600e3); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; })();

test('media settings: Ijaye admin saves valid links; bad ids, other domains and script-ish links refused', async () => {
  const media = { youtubeChannelId: 'UC' + 'a'.repeat(22), playlistId: 'PLabcdefghijk', youtubeUrl: 'https://www.youtube.com/@ccc',
    facebookUrl: 'https://www.facebook.com/ccc', tiktokUrl: '', instagramUrl: 'https://instagram.com/ccc', pastVideos: [{ id: 'dQw4w9WgXcQ', title: 'Sunday' }] };
  await assertSucceeds(setDoc(doc(as.ijayeAdmin(), 'webSite/home'), { media, updatedBy: 'uIj' }));
  await assertFails(setDoc(doc(as.ijayeAdmin(), 'webSite/home'), { media, updatedBy: 'someoneElse' }));
  await assertFails(setDoc(doc(as.ijayeAdmin(), 'webSite/home'), { media: { ...media, youtubeChannelId: 'bad' } }));
  await assertFails(setDoc(doc(as.ijayeAdmin(), 'webSite/home'), { media: { ...media, facebookUrl: 'https://evil.example/facebook.com' } }));
  await assertFails(setDoc(doc(as.ijayeAdmin(), 'webSite/home'), { media: { ...media, tiktokUrl: 'javascript:alert(1)' } }));
  await assertFails(setDoc(doc(as.ijayeAdmin(), 'webSite/home'), { media: { ...media, extra: 'x' } }));
  await assertFails(setDoc(doc(as.member(), 'webSite/home'), { media }));
});

test('published rosters: readable by Ijaye website members only; drafts and other parishes never', async () => {
  await seedWall();
  await assertSucceeds(getDoc(doc(ctxM(), 'parishes/ijaye/rosters/2026-11_r1')));
  await assertSucceeds(getDocs(query(collection(ctxM(), 'parishes/ijaye/rosters'), where('status', '==', 'Published'), where('month', 'in', ['2026-11', '2026-12']))));
  await assertFails(getDocs(collection(ctxM(), 'parishes/ijaye/rosters')));            // would include drafts
  await assertFails(getDoc(doc(ctxM(), 'parishes/ijaye/rosters/2026-11_r2')));          // draft
  await assertFails(getDoc(doc(ctxM(), 'parishes/other/rosters/2026-11_r1')));          // another parish
  await assertFails(getDoc(doc(as.visitor(), 'parishes/ijaye/rosters/2026-11_r1')));
  await assertFails(getDoc(doc(ctx('uOld'), 'parishes/ijaye/rosters/2026-11_r1')));    // disabled account
  await assertFails(getDoc(doc(ctx('uLag'), 'parishes/ijaye/rosters/2026-11_r1')));    // account of another parish
  await assertFails(getDoc(doc(ctx('uOther'), 'parishes/ijaye/rosters/2026-11_r1')));  // must still change password
  await assertFails(updateDoc(doc(ctxM(), 'parishes/ijaye/rosters/2026-11_r1'), { status: 'Draft' }));
});

// ======================= STEP 3: stories =======================
const newStory = (o = {}) => ({ kind: 'text', authorUid: 'uMem', authorName: 'Demo Member', text: 'Happy Sunday', bg: 2, hasPhoto: false,
  visibility: 'members', status: 'Visible', modVersion: 0, createdAt: serverTimestamp(), ...o });
const JPEG = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
const bday = (o = {}) => ({ kind: 'birthday', authorUid: 'system', authorName: 'Ijaye Parish', text: 'Halleluyah 🙌, happy birthday Tunde Example',
  bg: 0, hasPhoto: false, visibility: 'members', status: 'Visible', modVersion: 0, createdAt: serverTimestamp(), bdayId: 'b1', ...LAGOS, ...o });
const bdayId = (b = 'b1', L = LAGOS) => `webStories/bday_${L.y}_${L.m}_${L.d}_${b}`;

test('story read: visitors only public visible; members all visible; hidden only for author / office', async () => {
  await seedWall();
  await assertSucceeds(getDoc(doc(as.visitor(), 'webStories/pPublic')));
  await assertFails(getDoc(doc(as.visitor(), 'webStories/pMembers')));
  await assertFails(getDoc(doc(as.visitor(), 'webStories/pHidden')));
  await assertSucceeds(getDocs(query(collection(as.visitor(), 'webStories'), where('status', '==', 'Visible'), where('visibility', '==', 'public'), where('createdAt', '>', new Date(Date.now() - 864e5)))));
  await assertFails(getDocs(query(collection(as.visitor(), 'webStories'), where('status', '==', 'Visible'))));
  await assertSucceeds(getDocs(query(collection(ctxM(), 'webStories'), where('status', '==', 'Visible'), where('createdAt', '>', new Date(Date.now() - 864e5)))));
  await assertSucceeds(getDoc(doc(ctxM(), 'webStories/pHidden')));            // own
  await assertFails(getDoc(doc(ctx('uMem2'), 'webStories/pHidden')));
  await assertSucceeds(getDoc(doc(as.ijayeAdmin(), 'webStories/pHidden')));
  await assertFails(getDoc(doc(ctx('uOld'), 'webStories/pMembers')));       // disabled account
});

test('story create: text as yourself, fields fixed, server time; nobody deletes', async () => {
  await seedWall();
  await assertSucceeds(setDoc(doc(ctxM(), 'webStories/s1'), newStory()));
  await assertFails(setDoc(doc(ctxM(), 'webStories/s2'), newStory({ authorName: 'Bishop' })));
  await assertFails(setDoc(doc(ctxM(), 'webStories/s3'), newStory({ authorUid: 'uMem2' })));
  await assertFails(setDoc(doc(ctxM(), 'webStories/s4'), newStory({ createdAt: new Date(Date.now() + 864e5) })));   // cannot extend 24 h
  await assertFails(setDoc(doc(ctxM(), 'webStories/s5'), newStory({ status: 'Hidden' })));
  await assertFails(setDoc(doc(ctxM(), 'webStories/s6'), newStory({ text: 'x'.repeat(501) })));
  await assertFails(setDoc(doc(ctxM(), 'webStories/s7'), newStory({ to: 'uMem2' })));     // no private messages
  await assertFails(setDoc(doc(as.visitor(), 'webStories/s8'), newStory()));
  await assertFails(setDoc(doc(ctx('uOther'), 'webStories/s9'), newStory({ authorUid: 'uOther' })));   // must change password first
  await assertFails(deleteDoc(doc(ctxM(), 'webStories/pMembers')));
  await assertFails(deleteDoc(doc(as.ijayeAdmin(), 'webStories/pMembers')));
});

test('photo story: JPEG data in the same batch, <= ~150 KB, never replaced', async () => {
  await seedWall();
  const d = ctxM(), ok = writeBatch(d);
  ok.set(doc(d, 'webStories/ph1'), newStory({ kind: 'photo', hasPhoto: true, text: 'Harvest' }));
  ok.set(doc(d, 'webStories/ph1/photo/main'), { data: JPEG });
  await assertSucceeds(ok.commit());
  await assertFails(setDoc(doc(d, 'webStories/ph2'), newStory({ kind: 'photo', hasPhoto: true, text: '' })));   // no photo doc
  const big = writeBatch(d);
  big.set(doc(d, 'webStories/ph3'), newStory({ kind: 'photo', hasPhoto: true, text: '' }));
  big.set(doc(d, 'webStories/ph3/photo/main'), { data: 'data:image/jpeg;base64,' + 'A'.repeat(210000) });
  await assertFails(big.commit());
  const png = writeBatch(d);
  png.set(doc(d, 'webStories/ph4'), newStory({ kind: 'photo', hasPhoto: true, text: '' }));
  png.set(doc(d, 'webStories/ph4/photo/main'), { data: 'data:image/svg+xml;base64,AAAA' });
  await assertFails(png.commit());
  await assertFails(setDoc(doc(d, 'webStories/ph1/photo/main'), { data: JPEG }));                 // replace
  await assertFails(setDoc(doc(ctx('uMem2'), 'webStories/pOther/photo/main'), { data: JPEG }));   // add to an existing story
  await assertSucceeds(getDoc(doc(ctx('uMem2'), 'webStories/ph1/photo/main')));
  await assertFails(getDoc(doc(as.visitor(), 'webStories/ph1/photo/main')));                      // members-only story
});

test('birthday stories: today only, fixed id and text, from the list; second copy refused', async () => {
  await seedWall();
  await assertFails(setDoc(doc(as.visitor(), bdayId()), bday()));
  await assertFails(setDoc(doc(ctxM(), bdayId()), bday({ text: 'Halleluyah 🙌, happy birthday Someone Else' })));
  await assertFails(setDoc(doc(ctxM(), bdayId('b2')), bday({ bdayId: 'b2', text: 'Halleluyah 🙌, happy birthday Not Today' })));   // not their day
  const tomorrow = { ...LAGOS, d: LAGOS.d + 1 };
  await assertFails(setDoc(doc(ctxM(), bdayId('b1', tomorrow)), bday(tomorrow)));
  await assertFails(setDoc(doc(ctxM(), 'webStories/bday_custom'), bday()));                       // id must be deterministic
  await assertFails(setDoc(doc(ctxM(), bdayId()), bday({ visibility: 'public' })));
  await assertSucceeds(setDoc(doc(ctxM(), bdayId()), bday()));
  await assertFails(setDoc(doc(ctx('uMem2'), bdayId()), bday()));                                 // duplicate = update: refused
  await assertFails(setDoc(doc(ctxM(), 'webStories/s1'), newStory({ kind: 'birthday' })));
});

test('birthdays list: name/day/month only; members read; only the office writes', async () => {
  await seedWall();
  await assertSucceeds(getDocs(query(collection(ctxM(), 'webBirthdays'), where('month', '==', 1), where('day', '==', 1))));
  await assertFails(getDocs(collection(as.visitor(), 'webBirthdays')));
  await assertSucceeds(setDoc(doc(as.ijayeAdmin(), 'webBirthdays/b3'), { name: 'Ade', day: 5, month: 6 }));
  await assertFails(setDoc(doc(as.ijayeAdmin(), 'webBirthdays/b4'), { name: 'Ade', day: 5, month: 6, year: 1980 }));
  await assertFails(setDoc(doc(as.ijayeAdmin(), 'webBirthdays/b5'), { name: 'Ade', day: 32, month: 6 }));
  await assertFails(setDoc(doc(ctxM(), 'webBirthdays/b6'), { name: 'Me', day: 5, month: 6 }));
});

test('views: recorded once by the viewer; only the author (and office) see the list', async () => {
  await seedWall();
  const v = { name: 'Second Member', at: serverTimestamp() };
  await assertSucceeds(setDoc(doc(ctx('uMem2'), 'webStories/pMembers/views/uMem2'), v));
  await assertFails(setDoc(doc(ctx('uMem2'), 'webStories/pMembers/views/uMem2'), v));           // once
  await assertFails(setDoc(doc(ctx('uMem2'), 'webStories/pMembers/views/uMem'), { name: 'Demo Member', at: serverTimestamp() }));
  await assertFails(setDoc(doc(ctx('uMem2'), 'webStories/pPublic/views/uMem2'), { name: 'Fake', at: serverTimestamp() }));
  await assertFails(setDoc(doc(ctxM(), 'webStories/pMembers/views/uMem'), { name: 'Demo Member', at: serverTimestamp() }));   // own story
  await assertSucceeds(getDocs(collection(ctxM(), 'webStories/pMembers/views')));                 // author
  await assertFails(getDocs(collection(ctx('uMem2'), 'webStories/pMembers/views')));
  await assertSucceeds(getDocs(collection(as.ijayeAdmin(), 'webStories/pMembers/views')));
});

test('reactions: one emoji per member, own only, change or remove', async () => {
  await seedWall();
  await assertSucceeds(setDoc(doc(ctx('uMem2'), 'webStories/pMembers/reactions/uMem2'), { emoji: '🙏', at: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(ctx('uMem2'), 'webStories/pMembers/reactions/uMem2'), { emoji: '❤️', at: serverTimestamp() }));
  await assertFails(setDoc(doc(ctx('uMem2'), 'webStories/pMembers/reactions/uMem'), { emoji: '🙏', at: serverTimestamp() }));
  await assertFails(setDoc(doc(ctx('uMem2'), 'webStories/pMembers/reactions/uMem2'), { emoji: '<b>', at: serverTimestamp() }));
  await assertFails(setDoc(doc(as.visitor(), 'webStories/pPublic/reactions/x'), { emoji: '🙏', at: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(ctx('uMem2'), 'webStories/pMembers/reactions/uMem2')));
});

test('comments: members show at once; visitors only Pending on public stories', async () => {
  await seedWall();
  const c = (o) => ({ storyId: 'pPublic', storyPublic: true, authorUid: 'uMem', authorName: 'Demo Member', text: 'Amen', visitor: false, status: 'Visible', modVersion: 0, createdAt: serverTimestamp(), ...o });
  await assertSucceeds(addDoc(collection(ctxM(), 'webComments'), c()));
  await assertSucceeds(addDoc(collection(ctxM(), 'webComments'), c({ storyId: 'pMembers', storyPublic: false })));
  await assertFails(addDoc(collection(ctxM(), 'webComments'), c({ storyId: 'pMembers', storyPublic: true })));
  const vis = c({ authorUid: '', authorName: 'Mama V', visitor: true, status: 'Pending' });
  await assertSucceeds(addDoc(collection(as.visitor(), 'webComments'), vis));
  await assertFails(addDoc(collection(as.visitor(), 'webComments'), { ...vis, status: 'Visible' }));
  await assertFails(addDoc(collection(as.visitor(), 'webComments'), { ...vis, storyId: 'pMembers', storyPublic: false }));
  await assertFails(addDoc(collection(as.visitor(), 'webComments'), { ...vis, storyId: 'pHidden' }));
  await assertFails(getDoc(doc(as.visitor(), 'webComments/cPending')));
  await assertSucceeds(getDoc(doc(as.visitor(), 'webComments/cOk')));
  await assertFails(getDoc(doc(as.visitor(), 'webComments/cMem')));
});

test('moderation: office hides / approves with an audit entry; author may hide own; never deletes', async () => {
  await seedWall();
  const mod = (db, kind, id, status, action, by, v = 1) => {
    const b = writeBatch(db), target = (kind === 'story' ? 'webStories/' : 'webComments/') + id;
    b.update(doc(db, target), { status, modVersion: v, moderatedBy: by, moderatedAt: serverTimestamp() });
    b.set(doc(db, `webModLog/${kind === 'story' ? 'story' : 'cmt'}_${id}_${v}`), { target, action, by, at: serverTimestamp() });
    return b.commit();
  };
  await assertFails(updateDoc(doc(as.ijayeAdmin(), 'webStories/pPublic'), { status: 'Hidden', modVersion: 1, moderatedBy: 'uIj', moderatedAt: serverTimestamp() }));
  await assertSucceeds(mod(as.ijayeAdmin(), 'comment', 'cPending', 'Visible', 'approve', 'uIj'));
  await assertSucceeds(mod(as.ijayeAdmin(), 'story', 'pPublic', 'Hidden', 'hide', 'uIj'));
  await assertSucceeds(mod(as.ijayeAdmin(), 'story', 'pPublic', 'Visible', 'unhide', 'uIj', 2));
  await assertFails(mod(ctx('uMem2'), 'story', 'pMembers', 'Hidden', 'hide', 'uMem2'));
  await assertSucceeds(mod(ctxM(), 'story', 'pMembers', 'Hidden', 'hide', 'uMem'));
  await assertFails(mod(ctxM(), 'story', 'pMembers', 'Visible', 'unhide', 'uMem', 2));
  await assertFails(mod(as.otherAdmin(), 'story', 'pOther', 'Hidden', 'hide', 'uOt'));
  await assertFails(deleteDoc(doc(as.ijayeAdmin(), 'webModLog/story_pPublic_1')));
});
