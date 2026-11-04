// Daily birthday posts on the members' wall. Pure logic (takes Admin SDK handles) so the emulator test and the
// deployed scheduled function run the same code.
// PRIVACY: reads the Portal member/clergy records server-side and copies ONLY the display name. Never the year of
// birth, age, phone, address or anything else. Posts are members-only (never public).
const LAGOS = "Africa/Lagos";

function lagosDate(now = new Date()) {
    const s = now.toLocaleDateString("en-CA", { timeZone: LAGOS });   // YYYY-MM-DD
    const [y, m, d] = s.split("-").map(Number);
    return { ymd: s, month: m, day: d, year: y };
}
const firstNames = (full) => String(full || "").trim().replace(/\s+/g, " ").slice(0, 80);

/** Creates one wall post per Active Ijaye member/clergy whose birthday (day + month) is today. Safe to re-run. */
async function postBirthdays({ db, FieldValue }, now = new Date()) {
    const cfg = await db.doc("webSite/config").get();
    const parishId = cfg.exists ? cfg.data().parishId : null;
    if (!parishId) return { created: 0, reason: "webSite/config.parishId not set" };
    const { ymd, month, day } = lagosDate(now);
    const people = [];
    for (const col of ["members", "clergy"]) {
        const s = await db.collection(`parishes/${parishId}/${col}`)
            .where("status", "==", "Active").where("dobMonth", "==", month).where("dobDay", "==", day).get();
        s.forEach(d => people.push({ no: d.data().memberNo || d.data().clergyNo || d.id, name: firstNames(d.data().fullName) }));
    }
    let created = 0;
    for (const p of people) {
        if (!p.name) continue;
        const id = `bday_${ymd}_${String(p.no).replace(/[^A-Za-z0-9-]/g, "")}`;
        try {
            await db.doc(`webWall/${id}`).create({
                kind: "birthday", authorUid: "system", authorName: "Ijaye Parish", photoPath: "",
                text: `Halleluyah 🙌 Happy birthday to ${p.name}! May the Lord bless you with long life, joy and peace. Join us in celebrating our beloved today.`,
                visibility: "members", status: "Visible", modVersion: 0, createdAt: FieldValue.serverTimestamp()
            });
            created++;
        } catch (e) { if (e.code !== 6) throw e; }   // 6 = ALREADY_EXISTS: already posted today
    }
    return { created, date: ymd };
}
module.exports = { postBirthdays, lagosDate };
