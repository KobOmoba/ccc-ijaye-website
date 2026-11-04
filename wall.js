// Members' wall. Members post text + photo, like and comment. Birthday posts come from the daily Cloud Function
// (name only, never year/phone/address). NO private messages exist.
// Visitors: read-only, only posts the author marked "Visitors can see this too"; their comments wait for approval.
// Moderation (hide / approve) always writes a webModLog entry in the same batch. Nothing is deleted.
let photoBlob = null;
const timeAgo = (t) => {
    const d = t && t.toDate ? t.toDate() : new Date();
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" }) + " · " +
        d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
};
VIEW_RENDER.wall = () => renderWall();

async function renderWall() {
    if (!db) { $("wallFeed").innerHTML = `<p class="text-sm text-gray-400">The wall opens when the website is switched on.</p>`; return; }
    const member = state.who === "member" && account && !account.mustChangePassword, admin = state.who === "admin";
    $("composer").classList.toggle("hidden", !member);
    $("wallVisitorNote").classList.toggle("hidden", member || admin);
    let q = db.collection("webWall");
    q = admin ? q.orderBy("createdAt", "desc").limit(30)
        : member ? q.where("status", "==", "Visible").orderBy("createdAt", "desc").limit(30)
        : q.where("status", "==", "Visible").where("visibility", "==", "public").orderBy("createdAt", "desc").limit(20);
    const posts = (await q.get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(p => admin ? p.status === "Visible" : true);
    if (!posts.length) { $("wallFeed").innerHTML = `<p class="text-sm text-gray-400 text-center py-6">No posts yet.</p>`; return; }
    const html = await Promise.all(posts.map(p => postCard(p, member, admin)));
    $("wallFeed").innerHTML = html.join("");
}

async function postCard(p, member, admin) {
    let cq = db.collection("webComments").where("postId", "==", p.id).where("status", "==", "Visible");
    if (!member && !admin) cq = cq.where("postPublic", "==", true);
    const [cs, likes, photo] = await Promise.all([
        cq.get(),
        member || admin ? db.collection("webWall").doc(p.id).collection("likes").get() : null,
        p.photoPath ? storage.ref(p.photoPath).getDownloadURL().catch(() => "") : ""
    ]);
    const comments = cs.docs.map(d => d.data()).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    const liked = likes ? likes.docs.some(d => d.id === state.uid) : false;
    const bday = p.kind === "birthday";
    return `<article class="card p-3 ${bday ? "post-bday" : ""}" data-post="${esc(p.id)}">
        <div class="flex items-center gap-2">
            <div class="w-9 h-9 rounded-full ${bday ? "bg-amber-100" : "bg-navy"} flex items-center justify-center text-white font-black text-sm">${bday ? "🎂" : esc((p.authorName || "?")[0])}</div>
            <div class="flex-1 min-w-0"><p class="font-bold text-sm text-navy truncate">${esc(p.authorName)}</p><p class="text-[11px] text-gray-500">${timeAgo(p.createdAt)}
                ${member || admin ? `<span class="badge ${p.visibility === "public" ? "badge-public" : "badge-members"} ml-1">${p.visibility === "public" ? "Public" : "Members"}</span>` : ""}</p></div>
            ${member && p.authorUid === state.uid ? `<button onclick="hideOwnPost('${esc(p.id)}', ${p.modVersion || 0})" class="text-xs text-gray-500 font-bold">Hide</button>` : ""}
        </div>
        <p class="text-sm mt-2 whitespace-pre-line">${esc(p.text)}</p>
        ${photo ? `<img src="${esc(photo)}" alt="Photo shared by ${esc(p.authorName)}" class="mt-2 rounded-lg w-full" loading="lazy">` : ""}
        <div class="flex items-center gap-4 mt-2 text-sm text-gray-600">
            ${member ? `<button class="like-btn font-bold ${liked ? "text-[color:var(--rb-1)]" : ""}" onclick="toggleLike('${esc(p.id)}', ${liked})"><i class="fa-${liked ? "solid" : "regular"} fa-heart"></i> ${likes.size || ""}</button>`
                : likes ? `<span><i class="fa-regular fa-heart"></i> ${likes.size}</span>` : ""}
            <span><i class="fa-regular fa-comment"></i> ${comments.length}</span>
        </div>
        <div class="mt-2 space-y-1">${comments.map(c => `<p class="text-sm bg-gray-50 rounded-lg px-2 py-1"><b class="text-navy">${esc(c.authorName)}${c.visitor ? " (visitor)" : ""}:</b> ${esc(c.text)}</p>`).join("")}</div>
        ${member ? `<div class="flex gap-2 mt-2"><input maxlength="500" placeholder="Write a comment..." class="flex-1 border rounded-lg px-3 py-2 text-sm" id="c_${esc(p.id)}">
                <button onclick="addComment('${esc(p.id)}', ${p.visibility === "public"})" class="btn-navy rounded-lg px-3 text-sm font-bold">Send</button></div>`
          : !admin ? `<details class="mt-2"><summary class="text-xs font-bold text-navy cursor-pointer">Leave a comment</summary>
                <input maxlength="60" placeholder="Your name" class="w-full border rounded-lg px-3 py-2 text-sm mt-2" id="vn_${esc(p.id)}">
                <textarea maxlength="500" rows="2" placeholder="Your comment" class="w-full border rounded-lg px-3 py-2 text-sm mt-2" id="vc_${esc(p.id)}"></textarea>
                <button onclick="addVisitorComment('${esc(p.id)}')" class="btn-gold w-full rounded-lg py-2 text-sm font-bold mt-2">Send for approval</button>
                <p class="text-xs mt-1 hidden" id="vm_${esc(p.id)}"></p></details>` : ""}
    </article>`;
}

// ---- photo: shrink to JPEG (max 1280px) in the browser before upload (storage rules allow < 2 MB images only)
function pickPhoto(input) {
    const f = input.files && input.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) return setError("postError", "Please choose a photo.");
    const img = new Image();
    img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => { photoBlob = b; $("photoPreview").src = URL.createObjectURL(b); $("photoPreviewBox").classList.remove("hidden"); }, "image/jpeg", 0.82);
        URL.revokeObjectURL(img.src);
    };
    img.onerror = () => setError("postError", "That photo could not be opened.");
    img.src = URL.createObjectURL(f);
}
function clearPhoto() { photoBlob = null; $("photoInput").value = ""; $("photoPreviewBox").classList.add("hidden"); }

async function createPost() {
    setError("postError", "");
    const text = $("postText").value.trim();
    if (!text) return setError("postError", "Write something first.");
    busy("postBtn", true, "Posting...");
    try {
        const ref = db.collection("webWall").doc();
        let photoPath = "";
        if (photoBlob) {
            if (photoBlob.size >= 2 * 1024 * 1024) throw new Error("big");
            photoPath = `web/wall/${state.uid}/${ref.id}/photo.jpg`;
            await storage.ref(photoPath).put(photoBlob, { contentType: "image/jpeg" });
        }
        await ref.set({ kind: "post", authorUid: state.uid, authorName: account.displayName, text: text.slice(0, 1000), photoPath,
            visibility: $("postPublic").checked ? "public" : "members", status: "Visible", modVersion: 0, createdAt: ts() });
        $("postText").value = ""; $("postPublic").checked = false; clearPhoto();
        await renderWall();
    } catch (e) {
        setError("postError", e.message === "big" ? "That photo is too large." : "Could not post. Please try again.");
    } finally { busy("postBtn", false, "Post"); }
}

async function toggleLike(postId, liked) {
    const ref = db.collection("webWall").doc(postId).collection("likes").doc(state.uid);
    await (liked ? ref.delete() : ref.set({ at: ts() }));
    await renderWall();
}

async function addComment(postId, isPublic) {
    const el = $("c_" + postId), text = el.value.trim();
    if (!text) return;
    await db.collection("webComments").add({ postId, postPublic: isPublic, authorUid: state.uid, authorName: account.displayName,
        text: text.slice(0, 500), visitor: false, status: "Visible", modVersion: 0, createdAt: ts() });
    await renderWall();
}

async function addVisitorComment(postId) {
    const name = $("vn_" + postId).value.trim(), text = $("vc_" + postId).value.trim(), msg = $("vm_" + postId);
    msg.classList.remove("hidden");
    if (!name || !text) { msg.className = "text-xs mt-1 text-red-700"; msg.textContent = "Please write your name and a comment."; return; }
    try {
        await db.collection("webComments").add({ postId, postPublic: true, authorUid: "", authorName: name.slice(0, 60),
            text: text.slice(0, 500), visitor: true, status: "Pending", modVersion: 0, createdAt: ts() });
        $("vn_" + postId).value = $("vc_" + postId).value = "";
        msg.className = "text-xs mt-1 text-green-700"; msg.textContent = "Thank you! Your comment will show after the parish office approves it.";
    } catch (e) { msg.className = "text-xs mt-1 text-red-700"; msg.textContent = "Could not send. Please try again."; }
}

// Status change + audit entry in ONE batch (the rules refuse one without the other).
async function moderate(kind, id, curVersion, status, action) {
    const v = (curVersion || 0) + 1, target = (kind === "post" ? "webWall/" : "webComments/") + id;
    const b = db.batch();
    b.update(db.doc(target), { status, modVersion: v, moderatedBy: state.uid, moderatedAt: ts() });
    b.set(db.doc(`webModLog/${kind === "post" ? "post" : "cmt"}_${id}_${v}`), { target, action, by: state.uid, at: ts() });
    await b.commit();
}
async function hideOwnPost(id, ver) {
    if (!confirm("Hide this post? It will no longer show on the wall.")) return;
    await moderate("post", id, ver, "Hidden", "hide");
    await renderWall();
}
