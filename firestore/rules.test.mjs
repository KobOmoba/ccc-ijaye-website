// Website rules tests. Firestore EMULATOR only (demo project, never live).
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';

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
  await assertFails(getDoc(doc(as.visitor(), 'webSite/config')));
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
