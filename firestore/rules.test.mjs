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

test('nobody creates or deletes accounts from the browser (Cloud Function only)', async () => {
  await assertFails(setDoc(doc(as.member(), 'webAccounts/uNew'), acct()));
  await assertFails(setDoc(doc(ctx('uNew'), 'webAccounts/uNew'), acct()));
  await assertFails(setDoc(doc(as.ijayeAdmin(), 'webAccounts/uNew'), acct()));
  await assertFails(deleteDoc(doc(as.member(), 'webAccounts/uMem')));
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

test('audit log: admins read, nobody writes from the browser', async () => {
  await assertSucceeds(getDoc(doc(as.ijayeAdmin(), 'webAudit/a1')));
  await assertFails(getDoc(doc(as.member(), 'webAudit/a1')));
  await assertFails(addDoc(collection(as.ijayeAdmin(), 'webAudit'), { action: 'x' }));
});

test('website members cannot read Portal member records or users', async () => {
  await assertFails(getDoc(doc(as.member(), 'parishes/ijaye/members/CCC-IJY-ABK-MBR-001')));
  await assertFails(getDoc(doc(as.member(), 'users/uIj')));
});

// ======================= STEP 2: media settings, rosters, wall, comments, moderation =======================
async function seedWall() {
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    await setDoc(doc(d, 'webAccounts/uMem'), acct({ mustChangePassword: false }));
    await setDoc(doc(d, 'webAccounts/uOld'), acct({ memberNo: 'CCC-IJY-ABK-MBR-003', mustChangePassword: false, status: 'Disabled' }));
    await setDoc(doc(d, 'webAccounts/uLag'), acct({ memberNo: 'CCC-LAG-IKJ-MBR-001', parishId: 'other', mustChangePassword: false }));
    const post = (o) => ({ kind: 'post', authorUid: 'uMem', authorName: 'Demo Member', text: 'Hi', photoPath: '', visibility: 'members', status: 'Visible', modVersion: 0, createdAt: new Date(), ...o });
    await setDoc(doc(d, 'webWall/pMembers'), post());
    await setDoc(doc(d, 'webWall/pPublic'), post({ visibility: 'public' }));
    await setDoc(doc(d, 'webWall/pHidden'), post({ visibility: 'public', status: 'Hidden', modVersion: 1 }));
    await setDoc(doc(d, 'webComments/cPending'), { postId: 'pPublic', postPublic: true, authorUid: '', authorName: 'Visitor', text: 'God bless', visitor: true, status: 'Pending', modVersion: 0, createdAt: new Date() });
    await setDoc(doc(d, 'webComments/cOk'), { postId: 'pPublic', postPublic: true, authorUid: 'uMem', authorName: 'Demo Member', text: 'Amen', visitor: false, status: 'Visible', modVersion: 0, createdAt: new Date() });
    await setDoc(doc(d, 'webComments/cMem'), { postId: 'pMembers', postPublic: false, authorUid: 'uMem', authorName: 'Demo Member', text: 'Amen', visitor: false, status: 'Visible', modVersion: 0, createdAt: new Date() });
    const roster = (o) => ({ month: '2026-11', rev: 1, status: 'Published', rows: [], nos: [], ...o });
    await setDoc(doc(d, 'parishes/ijaye/rosters/2026-11_r1'), roster());
    await setDoc(doc(d, 'parishes/ijaye/rosters/2026-11_r2'), roster({ rev: 2, status: 'Draft' }));
    await setDoc(doc(d, 'parishes/other/rosters/2026-11_r1'), roster());
  });
}
const newPost = (o = {}) => ({ kind: 'post', authorUid: 'uMem', authorName: 'Demo Member', text: 'Happy Sunday', photoPath: '',
  visibility: 'members', status: 'Visible', modVersion: 0, createdAt: serverTimestamp(), ...o });
const ctxM = () => ctx('uMem');

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

test('wall read: visitors see only public visible posts; members see all visible; nobody else sees hidden', async () => {
  await seedWall();
  await assertSucceeds(getDoc(doc(as.visitor(), 'webWall/pPublic')));
  await assertFails(getDoc(doc(as.visitor(), 'webWall/pMembers')));
  await assertFails(getDoc(doc(as.visitor(), 'webWall/pHidden')));
  await assertSucceeds(getDocs(query(collection(as.visitor(), 'webWall'), where('status', '==', 'Visible'), where('visibility', '==', 'public'))));
  await assertFails(getDocs(query(collection(as.visitor(), 'webWall'), where('status', '==', 'Visible'))));
  await assertSucceeds(getDocs(query(collection(ctxM(), 'webWall'), where('status', '==', 'Visible'))));
  await assertFails(getDoc(doc(ctx('uOther'), 'webWall/pMembers')));
  await assertSucceeds(getDoc(doc(as.ijayeAdmin(), 'webWall/pHidden')));
  await assertFails(getDoc(doc(as.otherAdmin(), 'webWall/pHidden')));
});

test('wall post: members post as themselves only, default fields enforced, photo path in own folder', async () => {
  await seedWall();
  await assertSucceeds(setDoc(doc(ctxM(), 'webWall/n1'), newPost()));
  await assertSucceeds(setDoc(doc(ctxM(), 'webWall/n2'), newPost({ visibility: 'public', photoPath: 'web/wall/uMem/n2/photo.jpg' })));
  await assertFails(setDoc(doc(ctxM(), 'webWall/n3'), newPost({ photoPath: 'web/wall/uOther/n3/photo.jpg' })));
  await assertFails(setDoc(doc(ctxM(), 'webWall/n4'), newPost({ authorName: 'Bishop' })));
  await assertFails(setDoc(doc(ctxM(), 'webWall/n5'), newPost({ authorUid: 'uOther' })));
  await assertFails(setDoc(doc(ctxM(), 'webWall/n6'), newPost({ kind: 'birthday' })));
  await assertFails(setDoc(doc(ctxM(), 'webWall/n7'), newPost({ status: 'Hidden' })));
  await assertFails(setDoc(doc(ctxM(), 'webWall/n8'), newPost({ text: 'x'.repeat(1001) })));
  await assertFails(setDoc(doc(ctxM(), 'webWall/n9'), newPost({ to: 'uOther' })));   // no private messages
  await assertFails(setDoc(doc(as.visitor(), 'webWall/n10'), newPost()));            // visitors cannot post
  await assertFails(setDoc(doc(ctx('uOther'), 'webWall/n11'), newPost({ authorUid: 'uOther' })));
  await assertFails(setDoc(doc(as.ijayeAdmin(), 'webWall/n12'), newPost({ authorUid: 'uIj' })));
});

test('likes: one per member, own only, un-like allowed', async () => {
  await seedWall();
  await assertSucceeds(setDoc(doc(ctxM(), 'webWall/pMembers/likes/uMem'), { at: serverTimestamp() }));
  await assertFails(setDoc(doc(ctxM(), 'webWall/pMembers/likes/uOther'), { at: serverTimestamp() }));
  await assertFails(setDoc(doc(ctxM(), 'webWall/pHidden/likes/uMem'), { at: serverTimestamp() }));
  await assertFails(setDoc(doc(as.visitor(), 'webWall/pPublic/likes/x'), { at: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(ctxM(), 'webWall/pMembers/likes/uMem')));
});

const cmt = (o) => ({ postId: 'pPublic', postPublic: true, authorUid: 'uMem', authorName: 'Demo Member', text: 'Amen',
  visitor: false, status: 'Visible', modVersion: 0, createdAt: serverTimestamp(), ...o });
const vcmt = (o) => cmt({ authorUid: '', authorName: 'A visitor', visitor: true, status: 'Pending', ...o });

test('comments: members show at once; visitors only Pending on public posts', async () => {
  await seedWall();
  await assertSucceeds(addDoc(collection(ctxM(), 'webComments'), cmt()));
  await assertSucceeds(addDoc(collection(ctxM(), 'webComments'), cmt({ postId: 'pMembers', postPublic: false })));
  await assertFails(addDoc(collection(ctxM(), 'webComments'), cmt({ postId: 'pMembers', postPublic: true })));  // lie about visibility
  await assertFails(addDoc(collection(ctxM(), 'webComments'), cmt({ postId: 'pHidden' })));
  await assertFails(addDoc(collection(ctxM(), 'webComments'), cmt({ authorName: 'Pastor' })));
  await assertSucceeds(addDoc(collection(as.visitor(), 'webComments'), vcmt()));
  await assertFails(addDoc(collection(as.visitor(), 'webComments'), vcmt({ status: 'Visible' })));             // skip approval
  await assertFails(addDoc(collection(as.visitor(), 'webComments'), vcmt({ postId: 'pMembers', postPublic: false })));
  await assertFails(addDoc(collection(as.visitor(), 'webComments'), vcmt({ visitor: false, status: 'Visible', authorUid: 'uMem' })));
  await assertFails(addDoc(collection(as.visitor(), 'webComments'), vcmt({ text: 'x'.repeat(501) })));
});

test('comment reads: visitors see approved comments on public posts only, never Pending', async () => {
  await seedWall();
  await assertSucceeds(getDocs(query(collection(as.visitor(), 'webComments'), where('postId', '==', 'pPublic'), where('status', '==', 'Visible'), where('postPublic', '==', true))));
  await assertFails(getDoc(doc(as.visitor(), 'webComments/cPending')));
  await assertFails(getDoc(doc(as.visitor(), 'webComments/cMem')));
  await assertFails(getDoc(doc(ctxM(), 'webComments/cPending')));
  await assertSucceeds(getDoc(doc(ctxM(), 'webComments/cMem')));
  await assertSucceeds(getDocs(query(collection(as.ijayeAdmin(), 'webComments'), where('status', '==', 'Pending'))));
  await assertFails(getDocs(query(collection(ctxM(), 'webComments'), where('status', '==', 'Pending'))));
});

const modBatch = (db, target, logId, status, ver, by) => {
  const b = writeBatch(db);
  b.update(doc(db, target), { status, modVersion: ver, moderatedBy: by, moderatedAt: serverTimestamp() });
  b.set(doc(db, 'webModLog/' + logId), { target, action: status === 'Hidden' ? 'hide' : 'approve', by, at: serverTimestamp() });
  return b.commit();
};

test('moderation: admin approves / hides with an audit entry; never without one; never deletes', async () => {
  await seedWall();
  const a = as.ijayeAdmin();
  await assertFails(updateDoc(doc(a, 'webComments/cPending'), { status: 'Visible', modVersion: 1, moderatedBy: 'uIj', moderatedAt: serverTimestamp() }));  // no log
  await assertSucceeds(modBatch(a, 'webComments/cPending', 'cmt_cPending_1', 'Visible', 1, 'uIj'));
  await assertSucceeds(getDoc(doc(as.visitor(), 'webComments/cPending')));   // now approved -> visible to visitors
  await assertFails(modBatch(a, 'webComments/cPending', 'cmt_cPending_1', 'Hidden', 2, 'uIj'));   // log id must match the new version
  await assertSucceeds(modBatch(a, 'webComments/cPending', 'cmt_cPending_2', 'Hidden', 2, 'uIj'));
  await assertSucceeds(modBatch(a, 'webWall/pPublic', 'post_pPublic_1', 'Hidden', 1, 'uIj'));
  await assertFails(getDoc(doc(as.visitor(), 'webWall/pPublic')));
  await assertFails(modBatch(as.otherAdmin(), 'webWall/pMembers', 'post_pMembers_1', 'Hidden', 1, 'uOt'));
  await assertFails(modBatch(a, 'webWall/pMembers', 'post_pMembers_1', 'Deleted', 1, 'uIj'));
  await assertFails(deleteDoc(doc(a, 'webWall/pMembers')));
  await assertFails(deleteDoc(doc(a, 'webComments/cOk')));
  await assertFails(deleteDoc(doc(a, 'webModLog/post_pPublic_1')));
  await assertFails(updateDoc(doc(a, 'webModLog/post_pPublic_1'), { action: 'approve' }));
  await assertSucceeds(getDoc(doc(a, 'webModLog/post_pPublic_1')));
  await assertFails(getDoc(doc(ctxM(), 'webModLog/post_pPublic_1')));
});

test('moderation: members cannot moderate others; an author may hide (not un-hide) their own post', async () => {
  await seedWall();
  const m = ctxM();
  await assertFails(modBatch(m, 'webComments/cPending', 'cmt_cPending_1', 'Visible', 1, 'uMem'));
  await assertSucceeds(modBatch(m, 'webWall/pMembers', 'post_pMembers_1', 'Hidden', 1, 'uMem'));
  await assertFails(modBatch(m, 'webWall/pMembers', 'post_pMembers_2', 'Visible', 2, 'uMem'));
  await assertFails(modBatch(ctx('uOther'), 'webWall/pPublic', 'post_pPublic_1', 'Hidden', 1, 'uOther'));
  await assertFails(updateDoc(doc(m, 'webWall/pPublic'), { text: 'edited' }));
});
