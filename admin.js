// Parish office (Ijaye parish admin from the Portal, or super admin): moderation queue + website Settings.
// Settings = YouTube / Facebook / TikTok / Instagram links stored in webSite/home.media (rules re-check every value).
VIEW_RENDER.admin = () => { if (state.who === "admin") { renderModeration(); fillSettings(); } };

function adminTab(t) {
    $("tabMod").classList.toggle("active", t === "mod"); $("tabSettings").classList.toggle("active", t === "settings");
    $("adminMod").classList.toggle("hidden", t !== "mod"); $("adminSettings").classList.toggle("hidden", t !== "settings");
}

async function renderModeration() {
    const [pend, posts] = await Promise.all([
        db.collection("webComments").where("status", "==", "Pending").get(),
        db.collection("webWall").orderBy("createdAt", "desc").limit(30).get()
    ]);
    const pending = pend.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    $("pendingCount").textContent = pending.length; $("pendingCount").classList.toggle("hidden", !pending.length);
    const postText = {};
    posts.docs.forEach(d => { postText[d.id] = d.data().text; });
    $("pendingList").innerHTML = pending.length ? pending.map(c => `<div class="border rounded-lg p-2">
            <p><b class="text-navy">${esc(c.authorName)}</b> <span class="text-xs text-gray-500">(visitor)</span></p>
            <p class="mt-1">${esc(c.text)}</p>
            <p class="text-[11px] text-gray-500 mt-1">On: "${esc(String(postText[c.postId] || c.postId).slice(0, 60))}"</p>
            <div class="grid grid-cols-2 gap-2 mt-2">
                <button onclick="modAct('comment','${esc(c.id)}',${c.modVersion || 0},'Visible','approve')" class="btn-gold rounded-lg py-2 font-bold">Approve</button>
                <button onclick="modAct('comment','${esc(c.id)}',${c.modVersion || 0},'Hidden','hide')" class="border rounded-lg py-2 font-bold">Hide</button>
            </div></div>`).join("")
        : `<p class="text-gray-500">Nothing waiting. Halleluyah!</p>`;
    $("modPosts").innerHTML = posts.docs.map(d => ({ id: d.id, ...d.data() })).map(p => `<div class="border rounded-lg p-2 ${p.status === "Hidden" ? "bg-red-50" : ""}">
            <p class="text-xs"><b class="text-navy">${esc(p.authorName)}</b> · ${timeAgo(p.createdAt)}
              <span class="badge ${p.visibility === "public" ? "badge-public" : "badge-members"}">${p.visibility === "public" ? "Public" : "Members"}</span>
              ${p.status === "Hidden" ? `<span class="badge badge-hidden">Hidden</span>` : ""}${p.photoPath ? ` <i class="fa-solid fa-image text-gray-400"></i>` : ""}</p>
            <p class="mt-1">${esc(String(p.text).slice(0, 160))}</p>
            <button onclick="modAct('post','${esc(p.id)}',${p.modVersion || 0},'${p.status === "Hidden" ? "Visible" : "Hidden"}','${p.status === "Hidden" ? "unhide" : "hide"}')"
                class="mt-2 border rounded-lg px-3 py-1 text-xs font-bold">${p.status === "Hidden" ? "Show again" : "Hide"}</button></div>`).join("")
        || `<p class="text-gray-500">No posts yet.</p>`;
}
async function modAct(kind, id, ver, status, action) {
    try { await moderate(kind === "post" ? "post" : "comment", id, ver, status, action); }
    catch (e) { alert("Could not save: " + e.message); }
    await renderModeration();
}

// ---- Settings
function fillSettings() {
    const m = state.home.media || {};
    $("s_ytChannel").value = m.youtubeChannelId || ""; $("s_ytUrl").value = m.youtubeUrl || ""; $("s_playlist").value = m.playlistId || "";
    $("s_past").value = (m.pastVideos || []).map(v => `https://youtu.be/${v.id} | ${v.title || ""}`).join("\n");
    $("s_fb").value = m.facebookUrl || ""; $("s_tt").value = m.tiktokUrl || ""; $("s_ig").value = m.instagramUrl || "";
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
        facebookUrl: $("s_fb").value.trim(), tiktokUrl: $("s_tt").value.trim(), instagramUrl: $("s_ig").value.trim(), pastVideos: []
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
