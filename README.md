# CCC Archdiocesan Headquarters, Ijaye, Abeokuta — website

Public website + members-only area for Celestial Church of Christ, Archdiocesan HQ Ijaye.
Plain HTML/JS + Tailwind + Firebase (same project as the Parish Portal: `ccc-data-aarinat`). Hosted on Vercel.

## Step 1 (this PR)
- Public home page: hero, "Halleluyah 🙌" greeting, service times (placeholder),
  "Watch live / Past services" and "Our media" (placeholders for step 2), member sign-in.
- Member sign-in with the Portal member number + password; first login forces a new password.
- Draft Firestore rules for the website's own collections (`firestore/website.rules`), not deployed.

## Step 2
- **Public pages (no login):** service times, address, phone, map and about text from the Portal's `publicInfo/{parishId}`;
  "This week's Bible readings" from the Portal's `bibleReadings/{date}`.
- **Watch:** YouTube live embed (`embed/live_stream?channel=UC...`), a grid of up to 12 past services (thumbnail -> plays in
  the page) and an "All recordings" playlist embed. No YouTube API key needed.
- **Media hub:** YouTube, Facebook (official page embed + button), TikTok and Instagram (big buttons). Every link/ID is
  edited by the Ijaye admin on **Parish office > Settings** (stored in `webSite/home.media`). Empty = "Link coming soon".
- **Members area:** "My duties" and this month's SERVICE ROSTER from the Portal's *published* rosters (latest version wins;
  drafts never shown).
- **Members' wall:** text + photo posts, likes, comments. Birthday posts every morning from the Portal (name only; never
  year, phone or address; members-only). NO private messages. Visitors see only posts marked "Visitors can see this too"
  (default is members-only) and their comments wait for approval.
- **Parish office (Ijaye admin, Portal email login):** moderation queue (approve / hide visitor comments, hide / show posts)
  and Settings. Nothing is deleted (status Hidden); every action writes `webModLog` in the same batch (rules enforce it).
- Draft rules: `firestore/website.rules`, `firestore/storage.rules` (photos: jpeg/png/webp, < 2 MB, own folder, no
  overwrite/delete), `firestore/website.indexes.json`. Cloud Function `wallBirthdays` (daily 06:05 Lagos) in `functions/`.

## Login design
- Username = Portal member number (e.g. `CCC-IJY-ABK-MBR-001`), Ijaye parish only.
- Behind the scenes each number maps to a Firebase Auth email that can never receive mail:
  `ccc-ijy-abk-mbr-001@members.ijaye.invalid`. Passwords live only in Firebase Auth, never in Firestore.
- The Ijaye parish admin issues a temporary password from the Portal via the callable Cloud Function
  `issueWebPassword` (`functions/`). It checks the caller is the Ijaye parish admin, the member record exists
  in the Ijaye parish and is Active, creates/updates the Auth user, sets `webAccounts/{uid}.mustChangePassword = true`,
  ends old sessions, writes `webAudit`, and returns the temporary password once.
- Members cannot create accounts themselves. Forgot password = ask the parish office for a new temporary one.

## What Bayo must enable (nothing is live yet)
1. Firebase console > Authentication > Sign-in method: turn on **Email/Password**.
2. Upgrade `ccc-data-aarinat` to the **Blaze** plan (needed for Cloud Functions), then deploy `functions/`.
3. Paste the rules block marked WEBSITE from `firestore/website.rules` into the Portal's `firestore.rules`, then deploy.
4. Create `webSite/config` = `{ parishId: "<Ijaye parish id>" }` (Super Admin).
5. Paste the web app config into `config.js` (same values as the Portal) and add the Vercel domain to
   Authentication > Settings > Authorised domains.
6. Portal change (later step): an "Issue website password" button on the member record that calls `issueWebPassword`.
7. Step 2: in the Portal's `firestore.rules`, change the `rosters` read line as noted in `website.rules`, paste the new
   WEBSITE block, deploy `website.indexes.json` indexes, and merge `storage.rules` (turn on Cloud Storage if it is off).
8. Step 2: deploy the `wallBirthdays` function (same Blaze plan). Members need `dobDay`/`dobMonth` in the Portal.
9. Send the real links: YouTube channel (ID starting UC, or channel link), a playlist of past services, Facebook,
   TikTok and Instagram pages. The Ijaye admin types them into Parish office > Settings (no code change).

## Tests (emulator only, demo project)
```
cd firestore && npm install
npm test            # Firestore + Storage rules tests
npm run test:e2e    # phone-size browser test + screenshots (needs the functions/ deps: cd functions && npm install)
```
