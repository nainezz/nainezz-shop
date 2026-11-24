// Paste your Firebase web app settings here.
// Firebase console → Project settings → General → Your apps → Web app → "SDK setup and configuration" → Config.
// These values are meant to be public: security comes from firestore.rules and storage.rules, not from hiding them.
// Until apiKey is filled in, the site keeps working without a backend (orders go to WhatsApp only).
export default {
  apiKey: "AIzaSyA-Z38PMIpA2iURAmLVU7Gkn6EDZYZrcdk",
  authDomain: "nainezz-shop.firebaseapp.com",
  projectId: "nainezz-shop",
  storageBucket: "nainezz-shop.firebasestorage.app",
  messagingSenderId: "499682644497",
  appId: "1:499682644497:web:0212ee796f7eb6928257b0",
  // Free (Spark) plan: leave false — orders are saved straight from the website, paid on delivery.
  // Set to true only after deploying the Cloud Functions (needs the Blaze plan) to switch on M-Pesa.
  payments: false,
  // Must match the region in functions/index.js
  functionsRegion: "europe-west1"
};
