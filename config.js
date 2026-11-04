// Site config. The Firebase web config is NOT a secret (it only names the project; data is guarded by
// Firestore rules). Same values as the Parish Portal (CCC-DATA/app.js), project ccc-data-aarinat.
window.SITE_CONFIG = {
    firebase: {
        apiKey: "AIzaSyDtu61cYVY_IZG6-AyXpSOAwW2QZxkBoaU",
        authDomain: "ccc-data-aarinat.firebaseapp.com",
        projectId: "ccc-data-aarinat",
        storageBucket: "ccc-data-aarinat.firebasestorage.app",
        messagingSenderId: "762074026179",
        appId: "1:762074026179:web:3ce45d236531e5f1fe9276"
    },
    // Synthetic sign-in email for a member number: CCC-IJY-ABK-MBR-001 -> ccc-ijy-abk-mbr-001@members.ijaye.invalid
    // ".invalid" is a reserved domain: no email can ever be delivered to it.
    memberEmailDomain: "members.ijaye.invalid"
};
