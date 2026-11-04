// Members' wall = STORIES (like WhatsApp Status / Facebook Stories). FREE PLAN: everything is Firestore.
// - Row of round avatars at the top: rainbow ring = something new, grey ring = all seen (seen list kept on this phone).
// - Tap = full-screen viewer: progress bars, auto-advance, tap left/right = back/next, hold = pause, X = close.
// - Text-on-colour stories and photo stories (+ caption). Photos are shrunk on the phone to a JPEG <= ~150 KB and
//   stored in webStories/{id}/photo/main (rules enforce the size). No Cloud Storage.
// - Stories show for 24 h after createdAt and then stop showing. They stay in the database; nothing is deleted.
// - Birthday stories: made in the browser by the first signed-in member to open the site that day, from the
//   webBirthdays list (name + day + month only). The doc id is fixed per person per date, so it can never duplicate.
// - Emoji reactions + comments (visitor comments wait for approval). Authors see who viewed. NO private messages.
const BGS = ["linear-gradient(135deg,#b6940b,#e9c94a)", "linear-gradient(135deg,#031d48,#0b2c63)", "linear-gradient(135deg,#aa1f1b,#773246)",
    "linear-gradient(135deg,#0a4923,#045c6b)", "linear-gradient(135deg,#045c6b,#031d48)", "linear-gradient(135deg,#773246,#b6940b)",
    "linear-gradient(135deg,#1f2937,#4b5563)", "linear-gradient(135deg,#aa1f1b,#b6940b)"];
const EMOJIS = ["🙏", "❤️", "🙌", "🎉", "😂", "😮"];
const STORY_MS = 5000;
let stories = [], groups = [], viewer = null, draft = { kind: "text", bg: 1, photo: "" };

const seenSet = () => { try { return new Set(JSON.parse(localStorage.getItem("seenStories") || "[]")); } catch { return new Set(); } };
function markSeen(id) {
    try { const s = seenSet(); s.add(id); localStorage.setItem("seenStories", JSON.stringify([...s].slice(-400))); } catch { /* private mode */ }
}
const isMember = () => state.who === "member" && account && !account.mustChangePassword;
const hhmm = (t) => {
    const d = t && t.toDate ? t.toDate() : new Date(), mins = Math.max(0, Math.round((Date.now() - d) / 60000));
    return mins < 60 ? `${mins || 1}m ago` : `${Math.floor(mins / 60)}h ago`;
};
const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
VIEW_RENDER.wall = () => renderStories();

// ---------- birthdays: idempotent, client-side, once per day per person ----------
async function ensureBirthdayStories() {
    if (!isMember()) return;
    const [y, m, d] = lagosToday().split("-").map(Number);
    const list = await db.collection("webBirthdays").where("month", "==", m).where("day", "==", d).get();
    for (const b of list.docs) {
        const ref = db.collection("webStories").doc(`bday_${y}_${m}_${d}_${b.id}`);
        try {
            await db.runTransaction(async (tx) => {
                if ((await tx.get(ref)).exists) return;
                tx.set(ref, { kind: "birthday", authorUid: "system", authorName: "Ijaye Parish", text: "Halleluyah 🙌, happy birthday " + b.data().name,
                    bg: 0, hasPhoto: false, visibility: "members", status: "Visible", modVersion: 0, bdayId: b.id, y, m, d,
                    createdAt: ts() });
            });
        } catch (e) { /* someone else made it first, or a hidden one exists: fine */ }
    }
}
async function renderStories() {
    const feed = $("storyGrid"), row = $("storyRow");
    if (!db) { feed.innerHTML = `<p class="text-sm text-gray-400">Stories open when the website is switched on.</p>`; row.innerHTML = ""; return; }
    const member = isMember(), admin = state.who === "admin";
    $("wallVisitorNote").classList.toggle("hidden", member || admin);
    if (member) await ensureBirthdayStories().catch(e => console.warn("bday", e.message));
    const since = firebase.firestore.Timestamp.fromMillis(Date.now() - 24 * 3600 * 1000);
    let q = db.collection("webStories").where("status", "==", "Visible");
    if (!member && !admin) q = q.where("visibility", "==", "public");
    q = q.where("createdAt", ">", since).orderBy("createdAt", "asc").limit(100);
    stories = (await q.get()).docs.map(d => ({ id: d.id, ...d.data() }));
    // group by author (birthdays: one group per person), oldest first inside a group, like WhatsApp
    const by = new Map();
    for (const s of stories) {
        const key = s.kind === "birthday" ? "b_" + s.bdayId : s.authorUid;
        if (!by.has(key)) by.set(key, { key, name: s.kind === "birthday" ? s.text.replace("Halleluyah 🙌, happy birthday ", "") : s.authorName, bday: s.kind === "birthday", mine: s.authorUid === state.uid, items: [] });
        by.get(key).items.push(s);
    }
    const seen = seenSet();
    groups = [...by.values()].map(g => ({ ...g, items: g.items.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)),
        unseen: g.items.some(s => !seen.has(s.id)) }));
    groups.sort((a, b) => (b.bday - a.bday) || (b.mine - a.mine) || (b.unseen - a.unseen)
        || ((b.items.at(-1).createdAt?.seconds || 0) - (a.items.at(-1).createdAt?.seconds || 0)));
    const addBtn = member ? `<button class="story-av" onclick="openComposer()" aria-label="Add a story">
            <span class="ring add"><span class="face bg-navy">${esc(initials(account.displayName))}</span><span class="plus">+</span></span><span class="nm">Your story</span></button>` : "";
    row.innerHTML = addBtn + groups.map((g, i) => `<button class="story-av" data-group="${esc(g.key)}" onclick="openViewer(${i})">
            <span class="ring ${g.unseen ? "new" : "seen"}"><span class="face" style="background:${g.bday ? BGS[0] : BGS[1 + (g.name.length % 6)]}">${g.bday ? "🎂" : esc(initials(g.name))}</span></span>
            <span class="nm">${g.mine ? "You" : (g.bday ? "🎂 " : "") + esc(g.name.split(" ")[0])}</span></button>`).join("")
        || `<p class="text-xs text-gray-400 py-4">No stories in the last 24 hours.</p>`;
    // tiles (one per group: latest story)
    feed.innerHTML = groups.map((g, i) => { const s = g.items.at(-1); return `<button class="story-tile" onclick="openViewer(${i})" style="background:${BGS[s.bg || 0]}" data-tile="${esc(s.id)}">
            ${s.hasPhoto ? `<img data-photo="${esc(s.id)}" alt="" class="absolute inset-0 w-full h-full object-cover">` : ""}
            <span class="tile-txt">${s.hasPhoto ? "" : esc(s.text.slice(0, 90))}</span>
            <span class="tile-who"><span class="mini ${g.unseen ? "new" : ""}">${g.bday ? "🎂" : esc(initials(g.name))}</span>${g.mine ? "You" : esc(g.name)}</span></button>`; }).join("");
    feed.querySelectorAll("img[data-photo]").forEach(async (img) => { const u = await photoOf(img.dataset.photo); if (u) img.src = u; });
}
const photoCache = {};
async function photoOf(id) {
    if (!photoCache[id]) photoCache[id] = db.doc(`webStories/${id}/photo/main`).get().then(s => s.exists ? s.data().data : "").catch(() => "");
    return photoCache[id];
}

// ---------- full-screen viewer ----------
function openViewer(gi) {
    viewer = { gi, si: Math.max(0, groups[gi].items.findIndex(s => !seenSet().has(s.id))), t0: 0, left: STORY_MS, paused: false, raf: 0 };
    $("storyViewer").classList.remove("hidden"); document.body.style.overflow = "hidden";
    showStory();
}
function closeViewer() {
    if (!viewer) return; cancelAnimationFrame(viewer.raf); viewer = null;
    $("storyViewer").classList.add("hidden"); $("storySheet").classList.add("hidden"); document.body.style.overflow = "";
    renderStories().catch(e => console.warn("stories", e.message));   // may race a sign-out
}
async function showStory() {
    const g = groups[viewer.gi], s = g.items[viewer.si];
    cancelAnimationFrame(viewer.raf);
    $("svBars").innerHTML = g.items.map((_, i) => `<span class="bar"><i style="width:${i < viewer.si ? 100 : 0}%"></i></span>`).join("");
    $("svWho").innerHTML = `<span class="mini new">${g.bday ? "🎂" : esc(initials(g.name))}</span><span><b>${g.mine ? "Your story" : esc(g.bday ? "Birthday" : g.name)}</b><small>${hhmm(s.createdAt)}${s.visibility === "public" ? " · Public" : ""}</small></span>`;
    const stage = $("svStage");
    stage.style.background = BGS[s.bg || 0];
    stage.innerHTML = s.hasPhoto ? `<img id="svImg" alt="Photo story by ${esc(g.name)}" class="sv-photo"><p class="sv-cap">${esc(s.text)}</p>`
        : `<p class="sv-text ${s.kind === "birthday" ? "bday" : ""}">${s.kind === "birthday" ? "🎂<br>" : ""}${esc(s.text)}</p>`;
    viewer.left = STORY_MS; viewer.paused = false;
    if (s.hasPhoto) { viewer.paused = true; const u = await photoOf(s.id); if (!viewer) return; $("svImg").src = u; viewer.paused = false; }
    markSeen(s.id);
    renderActions(g, s);
    if (isMember() && !g.mine) db.doc(`webStories/${s.id}/views/${state.uid}`).set({ name: account.displayName, at: ts() }).catch(() => {});
    viewer.t0 = performance.now(); tick();
}
function tick() {
    if (!viewer) return;
    const now = performance.now();
    if (viewer.paused) { viewer.t0 = now; } else { viewer.left -= now - viewer.t0; viewer.t0 = now; }
    const bar = $("svBars").children[viewer.si];
    if (bar) bar.firstChild.style.width = Math.min(100, 100 * (1 - viewer.left / STORY_MS)) + "%";
    if (viewer.left <= 0) return step(1);
    viewer.raf = requestAnimationFrame(tick);
}
function step(dir) {
    if (!viewer) return;
    const g = groups[viewer.gi];
    viewer.si += dir;
    if (viewer.si >= g.items.length) { viewer.gi++; viewer.si = 0; if (viewer.gi >= groups.length) return closeViewer(); }
    if (viewer.si < 0) { viewer.gi--; if (viewer.gi < 0) { viewer.gi = 0; viewer.si = 0; } else viewer.si = groups[viewer.gi].items.length - 1; }
    showStory();
}
// tap left third = back, right = next; hold = pause
(function wireGestures() {
    let downAt = 0;
    const tap = () => $("svTap");
    window.addEventListener("DOMContentLoaded", () => {
        tap().addEventListener("pointerdown", () => { downAt = Date.now(); if (viewer) viewer.paused = true; });
        tap().addEventListener("pointerup", (e) => {
            if (!viewer) return;
            const held = Date.now() - downAt > 250; viewer.paused = !$("storySheet").classList.contains("hidden");
            if (held) return;
            const x = e.clientX / window.innerWidth;
            step(x < 0.33 ? -1 : 1);
        });
        tap().addEventListener("pointercancel", () => { if (viewer) viewer.paused = false; });
        document.addEventListener("keydown", (e) => { if (!viewer) return; if (e.key === "Escape") closeViewer(); if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); });
    });
})();

async function renderActions(g, s) {
    const bar = $("svActions"), member = isMember(), admin = state.who === "admin";
    if (g.mine) {
        bar.innerHTML = `<button class="sv-chip" onclick="openSheet('views')"><i class="fa-solid fa-eye"></i> <span id="svViewCount">…</span></button>
            <button class="sv-chip" onclick="openSheet('comments')"><i class="fa-regular fa-comment"></i> Comments</button>
            <button class="sv-chip" onclick="hideOwnStory()"><i class="fa-solid fa-eye-slash"></i> Hide</button>`;
        const v = await db.collection(`webStories/${s.id}/views`).get().catch(() => null);
        if ($("svViewCount")) $("svViewCount").textContent = v ? `Seen by ${v.size}` : "Seen by 0";
        return;
    }
    if (member) {
        const mine = await db.doc(`webStories/${s.id}/reactions/${state.uid}`).get().catch(() => null);
        const cur = mine && mine.exists ? mine.data().emoji : "";
        bar.innerHTML = EMOJIS.map(e => `<button class="sv-emoji ${e === cur ? "on" : ""}" onclick="react('${s.id}','${e}', ${e === cur})" aria-label="React ${e}">${e}</button>`).join("")
            + `<button class="sv-chip" onclick="openSheet('comments')"><i class="fa-regular fa-comment"></i></button>`;
    } else if (!admin && s.visibility === "public") {
        bar.innerHTML = `<button class="sv-chip w-full justify-center" onclick="openSheet('comments')"><i class="fa-regular fa-comment"></i> Comments · leave a message</button>`;
    } else bar.innerHTML = "";
}
async function react(id, emoji, undo) {
    const ref = db.doc(`webStories/${id}/reactions/${state.uid}`);
    await (undo ? ref.delete() : ref.set({ emoji, at: ts() })).catch(() => {});
    const g = groups[viewer.gi]; renderActions(g, g.items[viewer.si]);
}

// ---------- bottom sheet: comments / who viewed ----------
async function openSheet(kind) {
    if (!viewer) return;
    viewer.paused = true;
    const g = groups[viewer.gi], s = g.items[viewer.si], el = $("storySheet"), body = $("sheetBody");
    el.classList.remove("hidden");
    body.innerHTML = `<p class="text-sm text-gray-400">Loading…</p>`;
    if (kind === "views") {
        const [v, r] = await Promise.all([db.collection(`webStories/${s.id}/views`).get(), db.collection(`webStories/${s.id}/reactions`).get()]);
        const em = {}; r.docs.forEach(d => { em[d.id] = d.data().emoji; });
        $("sheetTitle").textContent = `Seen by ${v.size}`;
        body.innerHTML = v.docs.map(d => `<p class="flex items-center gap-2 py-1"><span class="mini">${esc(initials(d.data().name))}</span><span class="flex-1">${esc(d.data().name)}</span><span>${em[d.id] || ""}</span></p>`).join("")
            || `<p class="text-sm text-gray-500">Nobody yet.</p>`;
        return;
    }
    $("sheetTitle").textContent = "Comments";
    const member = isMember();
    let cq = db.collection("webComments").where("storyId", "==", s.id).where("status", "==", "Visible");
    if (!member && state.who !== "admin") cq = cq.where("storyPublic", "==", true);
    const cs = (await cq.get()).docs.map(d => d.data()).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    body.innerHTML = (cs.map(c => `<p class="text-sm bg-gray-50 rounded-lg px-2 py-1 mb-1"><b class="text-navy">${esc(c.authorName)}${c.visitor ? " (visitor)" : ""}:</b> ${esc(c.text)}</p>`).join("")
        || `<p class="text-sm text-gray-500 mb-2">No comments yet.</p>`)
        + (member ? `<div class="flex gap-2 mt-2"><input id="cText" maxlength="500" placeholder="Write a comment…" class="flex-1 border rounded-lg px-3 py-2 text-sm">
              <button onclick="addComment()" class="btn-navy rounded-lg px-3 text-sm font-bold">Send</button></div>`
          : state.who !== "admin" && s.visibility === "public" ? `<input id="vName" maxlength="60" placeholder="Your name" class="w-full border rounded-lg px-3 py-2 text-sm mt-2">
              <textarea id="vText" maxlength="500" rows="2" placeholder="Your comment" class="w-full border rounded-lg px-3 py-2 text-sm mt-2"></textarea>
              <button id="vSend" onclick="addVisitorComment()" class="btn-gold w-full rounded-lg py-2 text-sm font-bold mt-2">Send for approval</button>
              <p id="vMsg" class="text-xs mt-1 hidden"></p>` : "");
}
function closeSheet() { $("storySheet").classList.add("hidden"); if (viewer) viewer.paused = false; }
const curStory = () => groups[viewer.gi].items[viewer.si];
async function addComment() {
    const s = curStory(), text = $("cText").value.trim(); if (!text) return;
    await db.collection("webComments").add({ storyId: s.id, storyPublic: s.visibility === "public", authorUid: state.uid, authorName: account.displayName,
        text: text.slice(0, 500), visitor: false, status: "Visible", modVersion: 0, createdAt: ts() });
    openSheet("comments");
}
async function addVisitorComment() {
    const s = curStory(), name = $("vName").value.trim(), text = $("vText").value.trim(), msg = $("vMsg");
    msg.classList.remove("hidden");
    if (!name || !text) { msg.className = "text-xs mt-1 text-red-700"; msg.textContent = "Please write your name and a comment."; return; }
    try {
        await db.collection("webComments").add({ storyId: s.id, storyPublic: true, authorUid: "", authorName: name.slice(0, 60),
            text: text.slice(0, 500), visitor: true, status: "Pending", modVersion: 0, createdAt: ts() });
        $("vName").value = $("vText").value = "";
        msg.className = "text-xs mt-1 text-green-700"; msg.textContent = "Thank you! Your comment will show after the parish office approves it.";
    } catch (e) { msg.className = "text-xs mt-1 text-red-700"; msg.textContent = "Could not send. Please try again."; }
}

// ---------- composer ----------
function openComposer() {
    draft = { kind: "text", bg: 1, photo: "" };
    $("composer").classList.remove("hidden"); document.body.style.overflow = "hidden";
    $("cmpText").value = ""; $("cmpCaption").value = ""; $("cmpPublic").checked = false; setError("postError", "");
    composerMode("text");
}
function closeComposer() { $("composer").classList.add("hidden"); document.body.style.overflow = ""; }
function composerMode(k) {
    draft.kind = k;
    $("cmpTabText").classList.toggle("on", k === "text"); $("cmpTabPhoto").classList.toggle("on", k === "photo");
    $("cmpTextBox").classList.toggle("hidden", k !== "text"); $("cmpPhotoBox").classList.toggle("hidden", k !== "photo");
    $("cmpSwatches").innerHTML = BGS.map((b, i) => `<button class="swatch ${i === draft.bg ? "on" : ""}" style="background:${b}" onclick="pickBg(${i})" aria-label="Colour ${i + 1}"></button>`).join("");
    $("cmpTextBox").style.background = BGS[draft.bg];
}
function pickBg(i) { draft.bg = i; composerMode(draft.kind); }

// Shrink on the phone to a JPEG data URL of at most ~150 KB (rules refuse anything bigger).
const MAX_DATAURL = 200000;
function compressPhoto(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let side = 1080, q = 0.8, out = "";
            const c = document.createElement("canvas"), x = c.getContext("2d");
            for (let i = 0; i < 12; i++) {
                const k = Math.min(1, side / Math.max(img.width, img.height));
                c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
                x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
                out = c.toDataURL("image/jpeg", q);
                if (out.length <= MAX_DATAURL) break;
                if (q > 0.5) q -= 0.1; else side = Math.round(side * 0.8);
            }
            URL.revokeObjectURL(img.src);
            out.length <= MAX_DATAURL ? resolve(out) : reject(new Error("big"));
        };
        img.onerror = () => reject(new Error("open"));
        img.src = URL.createObjectURL(file);
    });
}
async function pickPhoto(input) {
    const f = input.files && input.files[0]; if (!f) return;
    setError("postError", "");
    if (!/^image\//.test(f.type)) return setError("postError", "Please choose a photo.");
    try {
        draft.photo = await compressPhoto(f);
        $("cmpPreview").src = draft.photo; $("cmpPreview").classList.remove("hidden"); $("cmpPickHint").classList.add("hidden");
        $("cmpSize").textContent = Math.round(draft.photo.length * 0.75 / 1024) + " KB";
    } catch (e) { setError("postError", e.message === "big" ? "That photo is too large." : "That photo could not be opened."); }
}

async function createStory() {
    setError("postError", "");
    const text = (draft.kind === "text" ? $("cmpText").value : $("cmpCaption").value).trim();
    if (draft.kind === "text" && !text) return setError("postError", "Write something first.");
    if (draft.kind === "photo" && !draft.photo) return setError("postError", "Choose a photo first.");
    busy("cmpShare", true, "Sharing…");
    try {
        const ref = db.collection("webStories").doc(), b = db.batch();
        b.set(ref, { kind: draft.kind, authorUid: state.uid, authorName: account.displayName, text: text.slice(0, draft.kind === "text" ? 500 : 300),
            bg: draft.bg, hasPhoto: draft.kind === "photo", visibility: $("cmpPublic").checked ? "public" : "members",
            status: "Visible", modVersion: 0, createdAt: ts() });
        if (draft.kind === "photo") b.set(ref.collection("photo").doc("main"), { data: draft.photo });
        await b.commit();
        closeComposer(); await renderStories();
    } catch (e) { setError("postError", "Could not share. Please try again."); console.warn(e.message); }
    finally { busy("cmpShare", false, "Share story"); }
}

// Status change + audit entry in ONE batch (the rules refuse one without the other).
async function moderate(kind, id, curVersion, status, action) {
    const v = (curVersion || 0) + 1, target = (kind === "story" ? "webStories/" : "webComments/") + id;
    const b = db.batch();
    b.update(db.doc(target), { status, modVersion: v, moderatedBy: state.uid, moderatedAt: ts() });
    b.set(db.doc(`webModLog/${kind === "story" ? "story" : "cmt"}_${id}_${v}`), { target, action, by: state.uid, at: ts() });
    await b.commit();
}
async function hideOwnStory() {
    const s = curStory();
    viewer.paused = true;
    if (!confirm("Hide this story? It will no longer show.")) { viewer.paused = false; return; }
    await moderate("story", s.id, s.modVersion, "Hidden", "hide");
    closeViewer();
}
