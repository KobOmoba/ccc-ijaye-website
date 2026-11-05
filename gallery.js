// "Life at Ijaye" photo mosaic. Photos are listed in assets/gallery/gallery.json (local files or https:// links).
// To add real photos: put them in assets/gallery/ and edit gallery.json. No Firebase needed.
(function () {
    const ok = (s) => typeof s === "string" && (/^assets\/gallery\/[\w.\-]+$/.test(s) || /^https:\/\/[^\s"<>]+$/.test(s));
    const e = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    fetch("assets/gallery/gallery.json", { cache: "no-cache" }).then((r) => r.json()).then((g) => {
        const photos = (g.photos || []).filter((p) => ok(p.src)).slice(0, 24);
        const box = document.getElementById("galleryGrid");
        if (!box) return;
        box.innerHTML = photos.length ? photos.map((p) => `<figure class="g-item${p.wide ? " wide" : ""}"><img src="${e(p.src)}" alt="${e(p.caption || "Church photo")}" loading="lazy" decoding="async">${p.caption ? `<figcaption>${e(p.caption)}</figcaption>` : ""}</figure>`).join("")
            : `<p class="text-white/80 text-sm">Photos coming soon.</p>`;
    }).catch(() => {});
})();
