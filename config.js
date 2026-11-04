// Site config. The Firebase web config is NOT a secret (it only names the project; data is guarded by
// Firestore rules), but it is kept out of this repo on purpose. BAYO: paste the web config of project
// ccc-data-aarinat here (Firebase console > Project settings > Your apps > Web app), the same values the
// Parish Portal uses. Until then the live site shows the public page only; sign-in is disabled.
window.SITE_CONFIG = {
    firebase: {
        apiKey: "PLACEHOLDER",
        authDomain: "ccc-data-aarinat.firebaseapp.com",
        projectId: "ccc-data-aarinat",
        appId: "PLACEHOLDER"
    },
    // Synthetic sign-in email for a member number: CCC-IJY-ABK-MBR-001 -> ccc-ijy-abk-mbr-001@members.ijaye.invalid
    // ".invalid" is a reserved domain: no email can ever be delivered to it.
    memberEmailDomain: "members.ijaye.invalid"
};
