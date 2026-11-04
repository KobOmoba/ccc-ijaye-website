// Issue (or reset) a member's website login. Pure logic, takes Admin SDK handles, so the emulator test
// and the deployed Cloud Function run exactly the same code.
const crypto = require("node:crypto");

const NO_RE = /^CCC-([A-Z]{2,4}-[A-Z]{2,4}-)?(MBR|CLG)-[0-9]{3,}$/;
const EMAIL_DOMAIN = "members.ijaye.invalid";   // must match config.js memberEmailDomain
// No look-alike characters (0/O, 1/l/I) so it can be read out over the phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

function tempPassword(len = 10) {
    let s = "";
    for (const b of crypto.randomBytes(len)) s += ALPHABET[b % ALPHABET.length];
    return s;
}
class Refused extends Error { constructor(code, msg) { super(msg); this.code = code; } }

/** Returns { memberNo, tempPassword } once. The password is never stored anywhere but Firebase Auth. */
async function issueTempPassword({ auth, db, FieldValue }, callerUid, rawNo) {
    const memberNo = String(rawNo || "").trim().toUpperCase();
    if (!callerUid) throw new Refused("unauthenticated", "Sign in first.");
    if (!NO_RE.test(memberNo)) throw new Refused("invalid-argument", "Not a member number.");

    const [caller, cfg] = await Promise.all([db.doc(`users/${callerUid}`).get(), db.doc("webSite/config").get()]);
    const parishId = cfg.exists ? cfg.data().parishId : null;
    if (!parishId) throw new Refused("failed-precondition", "Website parish is not set (webSite/config).");
    if (!caller.exists || caller.data().role !== "parish_admin" || caller.data().parishId !== parishId)
        throw new Refused("permission-denied", "Only the Ijaye parish admin can issue website logins.");
    const parish = await db.doc(`parishes/${parishId}`).get();
    if (!parish.exists || parish.data().status !== "Approved") throw new Refused("permission-denied", "Parish is not active.");

    // Ijaye parish only: the record must exist in THIS parish and be current.
    const kind = memberNo.includes("-CLG-") ? "clergy" : "members";
    const rec = await db.doc(`parishes/${parishId}/${kind}/${memberNo}`).get();
    if (!rec.exists || rec.data().status !== "Active") throw new Refused("not-found", "No active Ijaye record with that number.");

    const email = `${memberNo.toLowerCase()}@${EMAIL_DOMAIN}`;
    const password = tempPassword();
    let user;
    try {
        user = await auth.getUserByEmail(email);
        await auth.updateUser(user.uid, { password, disabled: false });
        await auth.revokeRefreshTokens(user.uid);           // old sessions end on reset
    } catch (e) {
        if (e.code !== "auth/user-not-found") throw e;
        user = await auth.createUser({ email, password, emailVerified: false });
    }
    await db.doc(`webAccounts/${user.uid}`).set({
        memberNo, parishId, displayName: rec.data().fullName || "", status: "Active",
        mustChangePassword: true, tempIssuedAt: FieldValue.serverTimestamp(), issuedBy: callerUid
    }, { merge: true });
    await db.collection("webAudit").add({ action: "issueTempPassword", memberNo, uid: user.uid, by: callerUid, at: FieldValue.serverTimestamp() });
    return { memberNo, tempPassword: password };
}

module.exports = { issueTempPassword, tempPassword, Refused, EMAIL_DOMAIN };
