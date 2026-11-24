// Paste your Firebase web app settings here.
// Firebase console → Project settings → General → Your apps → Web app → "SDK setup and configuration" → Config.
// These values are meant to be public: security comes from firestore.rules and storage.rules, not from hiding them.
// Until apiKey is filled in, the site keeps working without a backend (orders go to WhatsApp only).
export default {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.firebasestorage.app",
  messagingSenderId: "",
  appId: "",
  // Free (Spark) plan: leave false — orders are saved straight from the website, paid on delivery.
  // Set to true only after deploying the Cloud Functions (needs the Blaze plan) to switch on M-Pesa.
  payments: false,
  // Must match the region in functions/index.js
  functionsRegion: "europe-west1"
};
