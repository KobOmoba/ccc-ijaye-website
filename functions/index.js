// Cloud Function: issueWebPassword (callable). WRITTEN, NOT DEPLOYED.
// Needs the Blaze (pay-as-you-go) plan on ccc-data-aarinat. Bayo deploys it; see README "What Bayo must enable".
// The Parish Portal calls it from the member record: firebase.functions().httpsCallable("issueWebPassword")({ memberNo })
// and shows the returned temporary password to the admin ONCE, to hand to the member.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { issueTempPassword, Refused } = require("./issue");

initializeApp();

exports.issueWebPassword = onCall({ region: "europe-west1", enforceAppCheck: false }, async (req) => {
    try {
        return await issueTempPassword({ auth: getAuth(), db: getFirestore(), FieldValue }, req.auth?.uid, req.data?.memberNo);
    } catch (e) {
        if (e instanceof Refused) throw new HttpsError(e.code, e.message);
        console.error(e);
        throw new HttpsError("internal", "Could not issue the login.");
    }
});

// Daily birthday posts on the members' wall (06:05 Lagos time). WRITTEN, NOT DEPLOYED (needs Blaze, like above).
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { postBirthdays } = require("./birthdays");
exports.wallBirthdays = onSchedule({ schedule: "5 6 * * *", timeZone: "Africa/Lagos", region: "europe-west1" }, async () => {
    const r = await postBirthdays({ db: getFirestore(), FieldValue });
    console.log("birthday posts", r);
});
