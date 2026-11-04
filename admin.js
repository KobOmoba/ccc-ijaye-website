// Parish office (Ijaye parish admin from the Portal, or super admin): story moderation, logins (FREE PLAN issuing),
// birthdays list, website Settings.
// Settings = YouTube / Facebook / TikTok / Instagram links stored in webSite/home.media (rules re-check every value).
VIEW_RENDER.admin = () => { if (state.who === "admin") { renderModeration(); fillSettings(); renderAudit(); renderBirthdays(); } };

function adminTab(t) {
    for (const [k, tab, box] of [["mod", "tabMod", "adminMod"], ["logins", "tabLogins", "adminLogins"], ["bdays", "tabBdays", "adminBdays"], ["settings", "tabSettings", "adminSettings"]]) {
        $(tab).classList.toggle("active", t === k); $(box).classList.toggle("hidden", t !== k);
    }
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---- Logins (FREE PLAN): see issue-login.js. Only the Ijaye parish admin can (rules check it again).
async function issueLogin() {
    const msg = (t, ok) => { $("issueMsg").textContent = t; $("issueMsg").className = "text-sm " + (ok ? "text-green-700" : "text-red-700"); };
    $("issueResult").classList.add("hidden");
    busy("issueBtn", true, "Working...");
    try {
        const r = await issueWebLogin({ firebase, appConfig: state.appConfig, db, adminUid: state.uid, parishId: state.parishId,
            memberNo: $("issueNo").value, useEmulator: USE_EMULATOR });
        msg("Done. Shown only once:", true);
        $("issueResult").innerHTML = `<p class="text-xs text-gray-500">${esc(r.name)} · ${esc(r.memberNo)}</p>
            <p id="tempPw" class="text-2xl font-black tracking-widest text-navy my-1 select-all">${esc(r.tempPassword)}</p>
            <p class="text-[11px] text-gray-500">Member signs in with the number + this password, then chooses their own.</p>`;
        $("issueResult").classList.remove("hidden"); $("issueNo").value = "";
        renderAudit();
    } catch (e) { msg(e.message.startsWith("No active") || e.message.startsWith("That is") ? e.message : "Could not issue: " + e.message); }
    finally { busy("issueBtn", false, "Make temporary password"); }
}
async function renderAudit() {
    const s = await db.collection("webAudit").orderBy("at", "desc").limit(10).get().catch(() => null);
    $("auditList").innerHTML = s && s.size ? s.docs.map(d => d.data()).map(a => `<p class="text-xs"><b>${esc(a.memberNo)}</b> · ${a.action === "replaced" ? "old login switched off" : "temporary password issued (v" + (a.v || 1) + ")"} · ${timeAgo(a.at)}</p>`).join("")
        : `<p class="text-xs text-gray-500">None yet.</p>`;
}

// ---- Birthdays list (name + day + month only)
async function renderBirthdays() {
    if (!$("bMonth").options.length) $("bMonth").innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
    const s = await db.collection("webBirthdays").orderBy("month").orderBy("day").get().catch(() => null);
    $("bList").innerHTML = s && s.size ? s.docs.map(d => `<div class="flex items-center gap-2 border rounded-lg px-2 py-1"><span class="flex-1">${esc(d.data().name)}</span>
        <span class="text-xs text-gray-500">${d.data().day} ${MONTHS[d.data().month - 1]}</span>
        <button onclick="removeBirthday('${esc(d.id)}')" class="text-xs text-red-700 font-bold" aria-label="Remove">Remove</button></div>`).join("")
        : `<p class="text-xs text-gray-500">No birthdays yet.</p>`;
}
async function addBirthday() {
    const name = $("bName").value.trim(), day = Number($("bDay").value), month = Number($("bMonth").value);
    const msg = (t, ok) => { $("bMsg").textContent = t; $("bMsg").className = "text-sm " + (ok ? "text-green-700" : "text-red-700"); };
    if (!name || !(day >= 1 && day <= 31)) return msg("Write a name and a day (1-31).");
    try { await db.collection("webBirthdays").add({ name: name.slice(0, 60), day, month }); $("bName").value = $("bDay").value = ""; msg("Added.", true); renderBirthdays(); }
    catch (e) { msg("Not saved: " + e.message); }
}
async function removeBirthday(id) { if (confirm("Remove this birthday from the list?")) { await db.collection("webBirthdays").doc(id).delete(); renderBirthdays(); } }
const timeAgo = (t) => { const d = t && t.toDate ? t.toDate() : new Date();
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }); };

async function renderModeration() {
    const [pend, posts] = await Promise.all([
        db.collection("webComments").where("status", "==", "Pending").get(),
        db.collection("webStories").orderBy("createdAt", "desc").limit(30).get()
    ]);
    const pending = pend.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    $("pendingCount").textContent = pending.length; $("pendingCount").classList.toggle("hidden", !pending.length);
    const postText = {};
    posts.docs.forEach(d => { postText[d.id] = d.data().text || "(photo)"; });
    $("pendingList").innerHTML = pending.length ? pending.map(c => `<div class="border rounded-lg p-2">
            <p><b class="text-navy">${esc(c.authorName)}</b> <span class="text-xs text-gray-500">(visitor)</span></p>
            <p class="mt-1">${esc(c.text)}</p>
            <p class="text-[11px] text-gray-500 mt-1">On: "${esc(String(postText[c.storyId] || c.storyId).slice(0, 60))}"</p>
            <div class="grid grid-cols-2 gap-2 mt-2">
                <button onclick="modAct('comment','${esc(c.id)}',${c.modVersion || 0},'Visible','approve')" class="btn-gold rounded-lg py-2 font-bold">Approve</button>
                <button onclick="modAct('comment','${esc(c.id)}',${c.modVersion || 0},'Hidden','hide')" class="border rounded-lg py-2 font-bold">Hide</button>
            </div></div>`).join("")
        : `<p class="text-gray-500">Nothing waiting. Halleluyah!</p>`;
    $("modPosts").innerHTML = posts.docs.map(d => ({ id: d.id, ...d.data() })).map(p => `<div class="border rounded-lg p-2 ${p.status === "Hidden" ? "bg-red-50" : ""}">
            <p class="text-xs"><b class="text-navy">${esc(p.authorName)}</b> · ${timeAgo(p.createdAt)}
              <span class="badge ${p.visibility === "public" ? "badge-public" : "badge-members"}">${p.visibility === "public" ? "Public" : "Members"}</span>
              ${p.status === "Hidden" ? `<span class="badge badge-hidden">Hidden</span>` : ""}${p.hasPhoto ? ` <i class="fa-solid fa-image text-gray-400"></i>` : ""}${p.kind === "birthday" ? " 🎂" : ""}${(p.createdAt?.seconds || 0) * 1000 < Date.now() - 864e5 ? ` <span class="badge badge-members">Expired</span>` : ""}</p>
            <p class="mt-1">${esc(String(p.text).slice(0, 160))}</p>
            <button onclick="modAct('story','${esc(p.id)}',${p.modVersion || 0},'${p.status === "Hidden" ? "Visible" : "Hidden"}','${p.status === "Hidden" ? "unhide" : "hide"}')"
                class="mt-2 border rounded-lg px-3 py-1 text-xs font-bold">${p.status === "Hidden" ? "Show again" : "Hide"}</button></div>`).join("")
        || `<p class="text-gray-500">No posts yet.</p>`;
}
async function modAct(kind, id, ver, status, action) {
    try { await moderate(kind === "story" ? "story" : "comment", id, ver, status, action); }
    catch (e) { alert("Could not save: " + e.message); }
    await renderModeration();
}

// ---- Settings
function fillSettings() {
    const m = media();
    $("s_ytChannel").value = m.youtubeChannelId || ""; $("s_ytUrl").value = m.youtubeUrl || ""; $("s_playlist").value = m.playlistId || "";
    $("s_past").value = (m.pastVideos || []).map(v => `https://youtu.be/${v.id} | ${v.title || ""}`).join("\n");
    $("s_fb").value = m.facebookUrl || ""; $("s_fbName").value = m.facebookName || ""; $("s_tt").value = m.tiktokUrl || ""; $("s_ig").value = m.instagramUrl || "";
}
const videoIdOf = (s) => {
    s = s.trim();
    if (YT_VIDEO.test(s)) return s;
    const m = s.match(/(?:youtu\.be\/|[?&]v=|\/live\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : "";
};
const listIdOf = (s) => { s = s.trim(); const m = s.match(/[?&]list=([A-Za-z0-9_-]+)/); return m ? m[1] : s; };
const channelIdOf = (s) => { s = s.trim(); const m = s.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/); return m ? m[1] : s; };

async function saveSettings() {
    const msg = (t, ok) => { $("settingsMsg").textContent = t; $("settingsMsg").className = "text-sm " + (ok ? "text-green-700" : "text-red-700"); };
    const media = {
        youtubeChannelId: channelIdOf($("s_ytChannel").value), youtubeUrl: $("s_ytUrl").value.trim(), playlistId: listIdOf($("s_playlist").value),
        facebookUrl: $("s_fb").value.trim(), facebookName: $("s_fbName").value.trim().slice(0, 80), tiktokUrl: $("s_tt").value.trim(), instagramUrl: $("s_ig").value.trim(), pastVideos: []
    };
    if (media.youtubeChannelId && !YT_CHANNEL.test(media.youtubeChannelId)) return msg("The channel ID must start with UC and have 24 characters.");
    if (media.playlistId && !YT_LIST.test(media.playlistId)) return msg("That playlist link or ID does not look right.");
    for (const k of ["youtubeUrl", "facebookUrl", "tiktokUrl", "instagramUrl"])
        if (media[k] && !SAFE_URL[k].test(media[k])) return msg(`The ${k.replace("Url", "")} link must be a full https:// link to that site.`);
    const lines = $("s_past").value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (lines.length > 12) return msg("At most 12 past services. The full list is in the playlist.");
    for (const line of lines) {
        const [link, ...title] = line.split("|"), id = videoIdOf(link);
        if (!id) return msg(`Not a YouTube video link: ${line.slice(0, 40)}`);
        media.pastVideos.push({ id, title: title.join("|").trim().slice(0, 100) });
    }
    busy("settingsBtn", true, "Saving...");
    try {
        await db.doc("webSite/home").set({ media, updatedAt: ts(), updatedBy: state.uid }, { merge: true });
        state.home.media = media; renderPublic();
        msg("Saved. The Watch and Media pages now use these links.", true);
    } catch (e) { msg("Not saved: " + e.message); }
    finally { busy("settingsBtn", false, "Save settings"); }
}
