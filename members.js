// Members area: "My duties" + this month's SERVICE ROSTER, from the Parish Portal's PUBLISHED rosters
// (parishes/{p}/rosters/{YYYY-MM}_r{n}). Drafts are never readable by members. Latest published revision wins.
VIEW_RENDER.members = () => renderMembers();
const CORE = ["Service Conductor", "Lesson Reader 1", "Lesson Reader 2", "Preacher"];
const monthName = (m) => new Date(m + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const nextMonth = (m) => { const [y, mm] = m.split("-").map(Number); return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; };

async function loadRosters() {
    const cur = lagosToday().slice(0, 7);
    const s = await db.collection("parishes").doc(account.parishId).collection("rosters")
        .where("status", "==", "Published").where("month", "in", [cur, nextMonth(cur)]).get();
    const latest = {};
    s.docs.map(d => d.data()).forEach(r => { if (!latest[r.month] || r.rev > latest[r.month].rev) latest[r.month] = r; });
    return { cur, latest };
}

async function renderMembers() {
    if (state.who !== "member" || !account || account.mustChangePassword) return;
    let data;
    try { data = await loadRosters(); }
    catch (e) { $("myDuties").innerHTML = $("rosterView").innerHTML = `<p class="text-gray-400">Could not load the roster.</p>`; return; }
    const { cur, latest } = data, today = lagosToday(), no = account.memberNo;
    const mine = Object.values(latest).flatMap(r => r.rows.filter(x => x.date >= today)
        .flatMap(x => (x.duties || []).filter(d => d.no === no).map(d => ({ date: x.date, service: x.service, duty: d.duty }))))
        .sort((a, b) => a.date.localeCompare(b.date));
    $("myDuties").innerHTML = mine.length
        ? mine.map(d => `<div class="duty-row"><p class="font-bold text-navy">${esc(d.duty)}</p><p class="text-xs text-gray-600">${esc(fmtDay(d.date))} · ${esc(d.service)}</p></div>`).join("")
        : `<p class="text-gray-500">You have no duties on the published roster. Halleluyah!</p>`;

    const r = latest[cur];
    $("rosterTitle").textContent = "Service roster · " + monthName(cur);
    if (!r) { $("rosterView").innerHTML = `<p class="text-gray-500">This month's roster has not been published yet.</p>`; return; }
    const who = (row, duty) => { const d = (row.duties || []).find(x => x.duty === duty); return d ? `<span class="${d.no === no ? "bg-amber-100 font-bold rounded px-1" : ""}">${esc(d.name || "")}</span>` : `<span class="text-gray-400">-</span>`; };
    $("rosterView").innerHTML = r.rows.map(row => `<div class="border rounded-lg p-2 ${row.date < today ? "opacity-60" : ""}">
        <p class="font-black text-navy text-xs">${esc(row.service)} · ${esc(fmtDay(row.date))}</p>
        <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 mt-1 text-xs">
            <dt class="text-gray-500">Conductor</dt><dd>${who(row, "Service Conductor")}</dd>
            <dt class="text-gray-500">1st lesson</dt><dd>${esc(row.lesson1 || "-")} · ${who(row, "Lesson Reader 1")}</dd>
            <dt class="text-gray-500">2nd lesson</dt><dd>${esc(row.lesson2 || "-")} · ${who(row, "Lesson Reader 2")}</dd>
            <dt class="text-gray-500">Preacher</dt><dd>${who(row, "Preacher")}</dd>
            ${(row.duties || []).filter(d => !CORE.includes(d.duty)).map(d => `<dt class="text-gray-500">${esc(d.duty)}</dt><dd>${who(row, d.duty)}</dd>`).join("")}
        </dl></div>`).join("") + `<p class="text-[11px] text-gray-400">Version ${esc(r.rev)}. Your name is highlighted.</p>`;
}
