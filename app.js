// CCC Archdiocesan HQ Ijaye website - core: Firebase, views, sign-in.
// Members sign in with their Parish Portal member number. Behind the scenes that number maps to a
// synthetic Firebase Auth email (never shown, never mailed). Passwords live ONLY in Firebase Auth.
// Accounts are created by the parish admin through the Cloud Function in functions/ (not from this page).
// The Ijaye parish admin signs in with their normal Portal email to reach Settings + Moderation.

// Test mode: ?emulator=1 uses the local Auth + Firestore + Storage emulators under a demo project id.
const USE_EMULATOR = new URLSearchParams(location.search).has("emulator");
let auth = null, db = null, storage = null, account = null;
// who: "visitor" | "member" | "admin"
const state = { who: "visitor", uid: null, parishId: null, home: {}, isAdmin: false };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lagosToday = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });   // YYYY-MM-DD
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtDay = (ymd) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const ts = () => firebase.firestore.FieldValue.serverTimestamp();

const VIEW_RENDER = {};   // view name -> render function (filled by site.js, wall.js, members.js, admin.js)
function show(view) {
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + view));
    const nav = ["members", "admin", "signin", "changepw"].includes(view) ? "me" : view;
    document.querySelectorAll(".bottom-nav button").forEach(b => b.classList.toggle("on", b.dataset.nav === nav));
    window.scrollTo(0, 0);
    if (VIEW_RENDER[view]) Promise.resolve(VIEW_RENDER[view]()).catch(e => console.warn(view, e.message));
}
function showMe() { show(state.who === "admin" ? "admin" : state.who === "member" ? "members" : "signin"); }

// CCC-IJY-ABK-MBR-001 (new style) or CCC-MBR-001 (old style); members and clergy both have numbers.
function normaliseNo(raw) { return String(raw || "").trim().toUpperCase().replace(/\s+/g, ""); }
function isMemberNo(no) { return /^CCC-([A-Z]{2,4}-[A-Z]{2,4}-)?(MBR|CLG)-[0-9]{3,}$/.test(no); }
function emailFor(no) { return no.toLowerCase() + "@" + window.SITE_CONFIG.memberEmailDomain; }

function setError(id, msg) { const el = $(id); el.textContent = msg || ""; el.classList.toggle("hidden", !msg); }
function busy(id, on, label) { const b = $(id); b.disabled = on; b.style.opacity = on ? .6 : 1; if (label) b.textContent = label; }

window.addEventListener("load", async () => {
    const cfg = window.SITE_CONFIG.firebase;
    if (!window.firebase || (!USE_EMULATOR && cfg.apiKey.startsWith("PLACEHOLDER"))) {
        $("signinBtn").disabled = true; $("adminSigninBtn").disabled = true;
        setError("signinError", "Member sign-in is not switched on yet.");
        if (window.renderPublic) renderPublic();
        return;
    }
    firebase.initializeApp(USE_EMULATOR ? { ...cfg, apiKey: "demo-key", projectId: "demo-ccc", storageBucket: "demo-ccc" } : cfg);
    auth = firebase.auth();
    db = firebase.firestore();
    storage = firebase.storage();
    if (USE_EMULATOR) {
        auth.useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
        db.useEmulator("127.0.0.1", 8080);
        storage.useEmulator("127.0.0.1", 9199);
    }
    const start = (location.hash || "").slice(1);
    if (window.loadPublic) await loadPublic().catch(e => console.warn("public", e.message));
    auth.onAuthStateChanged(onAuthChanged);
    if (["watch", "media", "wall"].includes(start)) show(start);
});

function setWho(who) {
    state.who = who;
    $("headerSignIn").classList.toggle("hidden", who !== "visitor");
    $("headerSignOut").classList.toggle("hidden", who === "visitor");
    $("heroMemberBtn").innerHTML = who === "visitor" ? '<i class="fa-solid fa-user-lock mr-2"></i>Member sign in'
        : '<i class="fa-solid fa-user mr-2"></i>' + (who === "admin" ? "Parish office" : "My duties &amp; roster");
    $("heroMemberBtn").onclick = who === "visitor" ? () => show("signin") : showMe;
}

async function onAuthChanged(user) {
    account = null; state.uid = user ? user.uid : null;
    if (!user) { setWho("visitor"); return; }
    const snap = await db.collection("webAccounts").doc(user.uid).get().catch(() => null);
    if (snap && snap.exists) {
        account = snap.data();
        if (account.status !== "Active") return refuse("This account is not active. Please ask the parish office.");
        if (account.mustChangePassword) { setWho("member"); return show("changepw"); }
        setWho("member");
        $("memberGreeting").textContent = "Halleluyah 🙌, " + (account.displayName || "beloved");
        $("memberNoLine").textContent = "Member number " + account.memberNo;
        return show("members");
    }
    // Not a website member: maybe the Ijaye parish admin (Portal account) or a super admin.
    const prof = await db.collection("users").doc(user.uid).get().catch(() => null);
    const p = prof && prof.exists ? prof.data() : {};
    if (p.role === "super_admin" || (p.role === "parish_admin" && p.parishId === state.parishId)) {
        setWho("admin");
        return show("admin");
    }
    return refuse("This account cannot use the website. Please ask the parish office.");
}
async function refuse(msg) {
    await auth.signOut();
    show("signin");
    setError("signinError", msg);
}

async function signIn() {
    setError("signinError", "");
    const no = normaliseNo($("memberNo").value), pw = $("password").value;
    if (!isMemberNo(no)) return setError("signinError", "Enter your member number as it is on your card, e.g. CCC-IJY-ABK-MBR-001.");
    if (!pw) return setError("signinError", "Enter your password.");
    if (!auth) return;
    busy("signinBtn", true, "Signing in...");
    try {
        await auth.signInWithEmailAndPassword(emailFor(no), pw);
        $("password").value = "";
    } catch (e) {
        // One message for every failure, so the page never reveals which member numbers have accounts.
        setError("signinError", e.code === "auth/too-many-requests"
            ? "Too many tries. Please wait a few minutes and try again."
            : "Member number or password is not correct.");
    } finally { busy("signinBtn", false, "Sign in"); }
}

async function adminSignIn() {
    setError("signinError", "");
    if (!auth) return;
    busy("adminSigninBtn", true, "Signing in...");
    try {
        await auth.signInWithEmailAndPassword($("adminEmail").value.trim(), $("adminPw").value);
        $("adminPw").value = "";
    } catch (e) {
        setError("signinError", "Email or password is not correct.");
    } finally { busy("adminSigninBtn", false, "Sign in as parish office"); }
}

async function changePassword() {
    setError("changeError", "");
    const a = $("newPw").value, b = $("newPw2").value;
    if (a.length < 8) return setError("changeError", "Use at least 8 characters.");
    if (a !== b) return setError("changeError", "The two passwords are not the same.");
    busy("changeBtn", true, "Saving...");
    try {
        await auth.currentUser.updatePassword(a);
        await db.collection("webAccounts").doc(auth.currentUser.uid).update({
            mustChangePassword: false, passwordChangedAt: ts()
        });
        $("newPw").value = $("newPw2").value = "";
        await onAuthChanged(auth.currentUser);
    } catch (e) {
        setError("changeError", e.code === "auth/requires-recent-login"
            ? "Please sign out, sign in again with the temporary password, then try again."
            : "Could not save. Please try again.");
    } finally { busy("changeBtn", false, "Save new password"); }
}

async function signOut() { if (auth) await auth.signOut(); show("home"); }
