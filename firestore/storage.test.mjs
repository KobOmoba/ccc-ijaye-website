// Storage rules tests for wall photos. EMULATORS only (demo project, never live).
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

let env;
const st = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const up = (uid, path, bytes = JPG, contentType = 'image/jpeg') => uploadBytes(ref(st(uid), path), bytes, { contentType });

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-ccc',
    firestore: { rules: readFileSync(new URL('./website.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync(new URL('./storage.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 9199 } });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore(); await env.clearStorage();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    await setDoc(doc(d, 'webAccounts/uMem'), { status: 'Active', parishId: 'ijaye', mustChangePassword: false });
    await setDoc(doc(d, 'webAccounts/uOff'), { status: 'Disabled', parishId: 'ijaye', mustChangePassword: false });
    await setDoc(doc(d, 'users/uIj'), { role: 'parish_admin', parishId: 'ijaye' });
    await setDoc(doc(d, 'webWall/pPub'), { visibility: 'public', status: 'Visible' });
    await setDoc(doc(d, 'webWall/pMem'), { visibility: 'members', status: 'Visible' });
    await setDoc(doc(d, 'webWall/pHid'), { visibility: 'public', status: 'Hidden' });
    const s = c.storage();
    for (const p of ['pPub', 'pMem', 'pHid']) await uploadBytes(ref(s, `web/wall/uMem/${p}/photo.jpg`), JPG, { contentType: 'image/jpeg' });
  });
});

test('members upload small images into their own folder only', async () => {
  await assertSucceeds(up('uMem', 'web/wall/uMem/pNew/photo.jpg'));
  await assertSucceeds(up('uMem', 'web/wall/uMem/pNew2/photo.webp', JPG, 'image/webp'));
  await assertFails(up('uMem', 'web/wall/uOther/pNew/photo.jpg'));
  await assertFails(up(null, 'web/wall/uMem/pNew/photo.jpg'));
  await assertFails(up('uOff', 'web/wall/uOff/pNew/photo.jpg'));
  await assertFails(up('uIj', 'web/wall/uIj/pNew/photo.jpg'));
  await assertFails(up('uMem', 'web/wall/uMem/pNew/doc.pdf', JPG, 'application/pdf'));
  await assertFails(up('uMem', 'web/wall/uMem/pNew/x.svg', JPG, 'image/svg+xml'));   // SVG can carry script
  await assertFails(up('uMem', 'web/wall/uMem/pNew/big.jpg', new Uint8Array(2 * 1024 * 1024 + 10)));
  await assertFails(up('uMem', 'elsewhere/photo.jpg'));
});

test('no overwrite or delete from the browser', async () => {
  await assertFails(up('uMem', 'web/wall/uMem/pPub/photo.jpg'));
  await assertFails(deleteObject(ref(st('uMem'), 'web/wall/uMem/pPub/photo.jpg')));
});

test('photo reads follow the post: visitors only public + visible', async () => {
  await assertSucceeds(getBytes(ref(st(null), 'web/wall/uMem/pPub/photo.jpg')));
  await assertFails(getBytes(ref(st(null), 'web/wall/uMem/pMem/photo.jpg')));
  await assertFails(getBytes(ref(st(null), 'web/wall/uMem/pHid/photo.jpg')));
  await assertSucceeds(getBytes(ref(st('uMem'), 'web/wall/uMem/pMem/photo.jpg')));
  await assertSucceeds(getBytes(ref(st('uIj'), 'web/wall/uMem/pHid/photo.jpg')));
  await assertFails(getBytes(ref(st('uOff'), 'web/wall/uMem/pMem/photo.jpg')));
});
