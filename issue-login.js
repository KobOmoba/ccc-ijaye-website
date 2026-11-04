// FREE PLAN (Spark) website login issuing - no Cloud Function, no Admin SDK.
// HOOK FOR THE PORTAL: this file has no dependency on the website page. The Parish Portal can load it and call
//   issueWebLogin({ firebase, appConfig, db, adminUid, parishId, memberNo, useEmulator })
// with its own signed-in Firestore handle. Returns { memberNo, tempPassword, v } ONCE; the password is stored nowhere.
//
// How it works:
//  1. Checks the Ijaye record (members/ or clergy/) exists and is Active (the admin can read it under Portal rules).
//  2. A SECONDARY Firebase app instance creates the Auth user (so the admin's own session is untouched), and that
//     new user writes webClaims/{uid} = { memberNo, v } (rules: its email must be that number's sign-in email).
//  3. The admin, in ONE batch: creates webAccounts/{uid} (mustChangePassword: true), retires the older login
//     (status 'Replaced'), points webLogin/{memberNo} at the new version, and writes the webAudit entries.
//
// LIMITATION (free plan): a browser cannot change ANOTHER user's password (that needs the Admin SDK). Password-reset
// emails are impossible too (the sign-in emails end in .invalid). So a "reset" issues a NEW login version:
//   v1 = ccc-ijy-abk-mbr-001@members.ijaye.invalid, v2 = ccc-ijy-abk-mbr-001.v2@members.ijaye.invalid, ...
// The member still types only their member number; the sign-in page looks up the current version in webLogin.
// The old Auth user stays in Firebase Auth but is useless (its webAccounts status is 'Replaced').
// After the church approves Blaze, functions/issue.js (issueWebPassword) can do true resets instead.
const WEB_EMAIL_DOMAIN = "members.ijaye.invalid";
const NO_RE_WEB = /^CCC-([A-Z]{2,4}-[A-Z]{2,4}-)?(MBR|CLG)-[0-9]{3,}$/;
const PW_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";   // no 0/O, 1/l/I

function webEmailFor(memberNo, v) {
    return memberNo.toLowerCase() + (v > 1 ? ".v" + v : "") + "@" + WEB_EMAIL_DOMAIN;
}
function newTempPassword(len = 10) {
    const b = new Uint32Array(len); crypto.getRandomValues(b);
    return Array.from(b, x => PW_ALPHABET[x % PW_ALPHABET.length]).join("");
}

async function issueWebLogin({ firebase, appConfig, db, adminUid, parishId, memberNo: raw, useEmulator }) {
    const memberNo = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!NO_RE_WEB.test(memberNo)) throw new Error("That is not a member number.");
    const col = memberNo.includes("-CLG-") ? "clergy" : "members";
    const rec = await db.doc(`parishes/${parishId}/${col}/${memberNo}`).get();
    if (!rec.exists || rec.data().status !== "Active") throw new Error("No active Ijaye record with that number.");

    const cur = await db.doc(`webLogin/${memberNo}`).get();
    const old = (await db.collection("webAccounts").where("memberNo", "==", memberNo).get()).docs.filter(d => d.data().status === "Active");
    let v = cur.exists ? cur.data().v + 1 : (old.length ? 2 : 1);

    // Secondary app: its sign-in never touches the admin's session on the main app.
    const sec = firebase.apps.find(a => a.name === "issuer") || firebase.initializeApp(appConfig, "issuer");
    const secAuth = sec.auth();
    if (useEmulator && !secAuth.emulatorConfig) { secAuth.useEmulator("http://127.0.0.1:9099", { disableWarnings: true }); sec.firestore().useEmulator("127.0.0.1", 8080); }
    await secAuth.setPersistence(firebase.auth.Auth.Persistence.NONE);
    const password = newTempPassword();
    let cred = null;
    for (let tries = 0; tries < 5 && !cred; tries++) {
        try { cred = await secAuth.createUserWithEmailAndPassword(webEmailFor(memberNo, v), password); }
        catch (e) { if (e.code !== "auth/email-already-in-use") throw e; v++; }   // half-finished earlier try: next version
    }
    if (!cred) throw new Error("Could not create the login. Please try again.");
    const uid = cred.user.uid;
    try { await sec.firestore().doc(`webClaims/${uid}`).set({ memberNo, v }); }
    finally { await secAuth.signOut(); }

    const ts = firebase.firestore.FieldValue.serverTimestamp(), b = db.batch();
    b.set(db.doc(`webAccounts/${uid}`), { memberNo, parishId, displayName: rec.data().fullName || "", status: "Active",
        mustChangePassword: true, v, issuedBy: adminUid, issuedAt: ts });
    b.set(db.doc(`webAudit/issue_${uid}`), { action: "issueTempPassword", memberNo, uid, v, by: adminUid, at: ts });
    for (const o of old) {
        b.update(o.ref, { status: "Replaced", statusBy: adminUid, statusAt: ts });
        b.set(db.doc(`webAudit/replaced_${o.id}`), { action: "replaced", memberNo, uid: o.id, v: o.data().v || 1, by: adminUid, at: ts });
    }
    b.set(db.doc(`webLogin/${memberNo}`), { v, uid, updatedAt: ts });
    await b.commit();
    return { memberNo, tempPassword: password, v, name: rec.data().fullName || "" };
}
if (typeof window !== "undefined") Object.assign(window, { issueWebLogin, webEmailFor });
