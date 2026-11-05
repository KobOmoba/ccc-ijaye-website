// Public pages (no login): church info (Portal publicInfo), this week's Bible readings (Portal bibleReadings),
// live + past services (YouTube embeds, no API key) and the media hub. Links/IDs come from webSite/home.media,
// which the Ijaye parish admin edits on the Settings tab. Empty = clear placeholder.
const YT_VIDEO = /^[A-Za-z0-9_-]{11}$/, YT_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/, YT_LIST = /^(PL|UU|OL|FL)[A-Za-z0-9_-]{10,40}$/;
const SAFE_URL = {
    youtubeUrl: /^https:\/\/(www\.|m\.)?youtube\.com\/[^\s"<>]*$/,
    facebookUrl: /^https:\/\/(www\.|m\.|web\.)?facebook\.com\/[^\s"<>]*$/,
    tiktokUrl: /^https:\/\/(www\.)?tiktok\.com\/[^\s"<>]*$/,
    instagramUrl: /^https:\/\/(www\.)?instagram\.com\/[^\s"<>]*$/,
};
// Real church accounts (sent by Bayo, 4 Nov 2026). Defaults only: the Ijaye admin can change them in Settings.
// YouTube channel ID (UC...) not yet known, so the live embed waits; the handle link works now.
// Facebook page "CCC Ijaye Archdiocese" (confirmed URL). Instagram: none yet.
const DEFAULT_MEDIA = { youtubeUrl: "https://www.youtube.com/@cccijayearchdiocese", tiktokUrl: "https://www.tiktok.com/@celeijayeabkta_ng",
    facebookName: "CCC Ijaye Archdiocese", facebookUrl: "https://www.facebook.com/cccijayearchdiocese", youtubeChannelId: "", playlistId: "", instagramUrl: "", pastVideos: [] };
const media = () => { const m = state.home.media || {}, out = { ...DEFAULT_MEDIA };
    for (const k in m) if (m[k] !== "" && m[k] != null && !(Array.isArray(m[k]) && !m[k].length)) out[k] = m[k]; return out; };
const safeUrl = (k) => (SAFE_URL[k].test(media()[k] || "") ? media()[k] : "");
const ytChannelUrl = () => safeUrl("youtubeUrl") || (YT_CHANNEL.test(media().youtubeChannelId || "") ? "https://www.youtube.com/channel/" + media().youtubeChannelId : "");

async function loadPublic() {
    const [cfg, home] = await Promise.all([db.doc("webSite/config").get(), db.doc("webSite/home").get()]);
    state.parishId = cfg.exists ? cfg.data().parishId : null;
    state.home = home.exists ? home.data() : {};
    const today = lagosToday();
    const [info, rd] = await Promise.all([
        state.parishId ? db.doc("publicInfo/" + state.parishId).get() : null,
        db.collection("bibleReadings").where("date", ">=", today).where("date", "<=", addDays(today, 6)).orderBy("date").get()
    ]);
    state.info = info && info.exists ? info.data() : null;
    state.readings = rd.docs.map(d => d.data());
    renderPublic();
}

// Each service gets its own icon and sash colour, matched by name.
const SVC_STYLES = [[/prophet/i, "fa-eye", "#031d48"], [/new moon/i, "fa-circle-half-stroke", "#d63384"], [/vigil|night/i, "fa-moon", "#7b3fe4"],
    [/wakati|adura|hour/i, "fa-hourglass-half", "#b6940b"], [/seeker/i, "fa-hands-praying", "#0a4923"], [/bible|class/i, "fa-book-bible", "#045c6b"],
    [/mercy/i, "fa-heart", "#d63384"], [/evening/i, "fa-sun", "#e8590c"], [/morning|dawn/i, "fa-cloud-sun", "#3fa9f5"], [/power/i, "fa-bolt", "#b6940b"], [/sunday/i, "fa-church", "#aa1f1b"]];
const svcStyle = (s) => (SVC_STYLES.find(([re]) => re.test(s)) || [0, "fa-bell", "#773246"]).slice(1);

function renderPublic() {
    const i = state.info;
    if (i) {
        if ((i.services || []).length) {
            $("serviceTimes").innerHTML = i.services.map(s => { const [ic, c] = svcStyle(s); return `<li class="svc" style="--c:${c}"><i class="fa-solid ${ic}"></i><b>${esc(s)}</b></li>`; }).join("");
            $("timesNote").textContent = "From the parish office.";
        }
        if (i.about) $("aboutText").textContent = i.about;
        if (i.address) $("addressText").innerHTML = `<i class="fa-solid fa-location-dot text-gold mr-2"></i>${esc(i.address)}`;
        const tel = String(i.phone || "").replace(/[^0-9+]/g, "");
        if (tel) { $("callBtn").href = "tel:" + tel; $("callBtn").classList.remove("hidden"); }
        if (/^https:\/\/\S+$/.test(i.mapsUrl || "")) { $("mapBtn").href = i.mapsUrl; $("mapBtn").classList.remove("hidden"); }
        $("visitNote").classList.toggle("hidden", !!(tel && i.mapsUrl));
    }
    const r = state.readings || [];
    if (r.length) $("readingsList").innerHTML = r.map(d => `<div><p class="font-bold text-navy">${esc(fmtDay(d.date))}</p>
        ${(d.services || []).map(s => `<p class="text-gray-700"><span class="text-gray-500">${esc(s.service)}:</span> ${esc(s.readings)}</p>`).join("")}</div>`).join("");
    else $("readingsList").innerHTML = `<p class="text-gray-400">This week's readings will show here once the church office adds them.</p>`;
    renderWatch(); renderMedia();
}

const placeholder = (icon, text) => `<div class="placeholder-box"><i class="${icon} text-3xl text-[color:var(--gold-light)]"></i>
    <p class="text-sm font-bold mt-2">${esc(text)}</p><p class="text-[11px] opacity-70 mt-1">The parish office will add this soon.</p></div>`;
const ytFrame = (src, title) => `<iframe src="${esc(src)}" title="${esc(title)}" class="w-full h-full" loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;

function renderWatch() {
    const m = media();
    $("livePlayer").innerHTML = YT_CHANNEL.test(m.youtubeChannelId || "")
        ? ytFrame("https://www.youtube.com/embed/live_stream?channel=" + m.youtubeChannelId, "Live service")
        : placeholder("fa-solid fa-tower-broadcast", "Live service will show here");
    const past = (m.pastVideos || []).filter(v => YT_VIDEO.test(v.id || ""));
    $("pastGrid").innerHTML = past.length ? past.map(v => `<button class="text-left" onclick="playPast('${v.id}')">
            <div class="thumb"><img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" alt="" loading="lazy"><span class="play"><i class="fa-solid fa-circle-play"></i></span></div>
            <p class="text-xs font-bold text-navy mt-1 line-clamp-2">${esc(v.title || "Service recording")}</p></button>`).join("")
        : `<p class="col-span-2 text-sm text-gray-400">Past service recordings will be listed here.</p>`;
    const list = YT_LIST.test(m.playlistId || "");
    $("playlistBox").classList.toggle("hidden", !list);
    if (list) $("playlistPlayer").innerHTML = ytFrame("https://www.youtube.com/embed/videoseries?list=" + m.playlistId, "All recordings");
    const ch = ytChannelUrl();
    $("ytChannelBtn").classList.toggle("hidden", !ch);
    if (ch) $("ytChannelBtn").href = ch;
}
function playPast(id) {
    if (!YT_VIDEO.test(id)) return;
    $("livePlayer").innerHTML = ytFrame("https://www.youtube.com/embed/" + id + "?autoplay=1", "Service recording");
    $("livePlayer").scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderMedia() {
    const fb = safeUrl("facebookUrl");
    const card = (url, icon, name, color, sub) => url
        ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="media-card" style="background:${color}"><i class="${icon} big"></i><span class="flex-1">${name}<span class="block text-xs font-semibold opacity-80">${sub}</span></span><i class="fa-solid fa-arrow-up-right-from-square"></i></a>`
        : `<div class="media-card off"><i class="${icon} big"></i><span class="flex-1">${name}<span class="block text-xs font-semibold">Link coming soon</span></span></div>`;
    $("mediaHub").innerHTML = [
        card(ytChannelUrl(), "fa-brands fa-youtube", "YouTube", "#c4302b", "Live services and recordings"),
        card(fb, "fa-brands fa-facebook", "Facebook" + (media().facebookName ? " · " + esc(media().facebookName) : ""), "#1b4fa0", "News and photos"),
        fb ? `<div class="card p-2 overflow-hidden"><iframe title="Facebook page" class="w-full" style="height:420px;border:0" loading="lazy"
            src="https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(fb)}&tabs=timeline&width=340&height=420&small_header=true&adapt_container_width=true"></iframe></div>` : "",
        card(safeUrl("tiktokUrl"), "fa-brands fa-tiktok", "TikTok", "#111827", "Short clips"),
        // Instagram: church no longer uses it (Bayo, 5 Nov 2026); only shown if a link is ever added.
        !safeUrl("instagramUrl") ? "" : card(safeUrl("instagramUrl"), "fa-brands fa-instagram", "Instagram", "linear-gradient(135deg,#773246,#aa1f1b,#b6940b)", "Pictures from church"),
    ].join("") + `<button onclick="show('watch')" class="w-full btn-gold font-bold py-3 rounded-xl"><i class="fa-solid fa-circle-play mr-2"></i>Watch live &amp; past services</button>`;
}
