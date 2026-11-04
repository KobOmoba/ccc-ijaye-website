# CCC Archdiocesan Headquarters, Ijaye, Abeokuta — website

Public website + members-only area for Celestial Church of Christ, Archdiocesan HQ Ijaye.
Plain HTML/JS + Tailwind + Firebase (same project as the Parish Portal: `ccc-data-aarinat`). Hosted on Vercel.

## Step 1 (this PR)
- Public home page: hero, "Halleluyah 🙌" greeting, service times (placeholder),
  "Watch live / Past services" and "Our media" (placeholders for step 2), member sign-in.
- Member sign-in with the Portal member number + password; first login forces a new password.
- Draft Firestore rules for the website's own collections (`firestore/website.rules`), not deployed.

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

## Tests (emulator only, demo project)
```
cd firestore && npm install
npm test            # rules tests
npm run test:e2e    # phone-size browser test + screenshots (needs the functions/ deps: cd functions && npm install)
```
