// CCC Archdiocesan HQ Ijaye website - public page + member sign-in.
// Members sign in with their Parish Portal member number. Behind the scenes that number maps to a
// synthetic Firebase Auth email (never shown, never mailed). Passwords live ONLY in Firebase Auth.
// Accounts are created by the parish admin through the Cloud Function in functions/ (not from this page).

// Test mode: ?emulator=1 uses the local Auth + Firestore emulators under a demo project id.
const USE_EMULATOR = new URLSearchParams(location.search).has("emulator");
let auth = null, db = null, account = null;
const $ = (id) => document.getElementById(id);

function show(view) {
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + view));
    window.scrollTo(0, 0);
}

// CCC-IJY-ABK-MBR-001 (new style) or CCC-MBR-001 (old style); members and clergy both have numbers.
function normaliseNo(raw) { return String(raw || "").trim().toUpperCase().replace(/\s+/g, ""); }
function isMemberNo(no) { return /^CCC-([A-Z]{2,4}-[A-Z]{2,4}-)?(MBR|CLG)-[0-9]{3,}$/.test(no); }
function emailFor(no) { return no.toLowerCase() + "@" + window.SITE_CONFIG.memberEmailDomain; }

function setError(id, msg) { const el = $(id); el.textContent = msg || ""; el.classList.toggle("hidden", !msg); }
function busy(id, on, label) { const b = $(id); b.disabled = on; b.style.opacity = on ? .6 : 1; if (label) b.textContent = label; }

window.addEventListener("load", () => {
    const cfg = window.SITE_CONFIG.firebase;
    if (!window.firebase || (!USE_EMULATOR && cfg.apiKey.startsWith("PLACEHOLDER"))) {
        $("signinBtn").disabled = true;
        setError("signinError", "Member sign-in is not switched on yet.");
        return;
    }
    firebase.initializeApp(USE_EMULATOR ? { ...cfg, apiKey: "demo-key", projectId: "demo-ccc" } : cfg);
    auth = firebase.auth();
    db = firebase.firestore();
    if (USE_EMULATOR) {
        auth.useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
        db.useEmulator("127.0.0.1", 8080);
    }
    auth.onAuthStateChanged(onAuthChanged);
});

async function onAuthChanged(user) {
    $("headerSignIn").classList.toggle("hidden", !!user);
    $("headerSignOut").classList.toggle("hidden", !user);
    if (!user) { account = null; return; }
    const snap = await db.collection("webAccounts").doc(user.uid).get().catch(() => null);
    account = snap && snap.exists ? snap.data() : null;
    if (!account || account.status !== "Active") {
        await auth.signOut();
        show("signin");
        setError("signinError", "This account is not active. Please ask the parish office.");
        return;
    }
    if (account.mustChangePassword) return show("changepw");
    $("memberGreeting").textContent = "Halleluyah 🙌, " + (account.displayName || "beloved");
    $("memberNoLine").textContent = "Member number " + account.memberNo;
    show("members");
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

async function changePassword() {
    setError("changeError", "");
    const a = $("newPw").value, b = $("newPw2").value;
    if (a.length < 8) return setError("changeError", "Use at least 8 characters.");
    if (a !== b) return setError("changeError", "The two passwords are not the same.");
    busy("changeBtn", true, "Saving...");
    try {
        await auth.currentUser.updatePassword(a);
        await db.collection("webAccounts").doc(auth.currentUser.uid).update({
            mustChangePassword: false, passwordChangedAt: firebase.firestore.FieldValue.serverTimestamp()
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
