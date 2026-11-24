# Backend setup (Firebase)

The website works without this — orders just go to WhatsApp. There are two levels:

**Free plan (Spark) — no card needed. This is the current setup.**
- **Admin page** (`/admin.html`): prices, stock, hide/add products, shop details.
- **Orders saved** with a dashboard (orders today, money in today / this month, orders to deliver).
- **Live prices and stock** on the website; sold-out items can't be added to the cart.
- Stock goes down when you mark an order **Paid** or **Delivered**, and back up if you mark it **Cancelled**.
- Customers pay on delivery; each order still goes to you on WhatsApp to confirm.
- Photos: put them in the `images/` folder of the repo and type the name in the admin page.

**Paid plan (Blaze) — later, for M-Pesa on the website.** Adds STK push payments that mark orders Paid automatically,
server-side price checks and photo uploads. Steps are under *Later: M-Pesa* below.

## Free plan setup
1. **Firebase project** (done): Firestore database, Authentication with Email/Password and your admin user.
2. **Connect the website**: Project settings → General → Your apps → Web `</>` → register an app (no hosting) →
   copy the config values into `assets/firebase-config.js` (or send them to Claude to do it). Leave `payments: false`.
3. **Security rules**: Firebase console → Firestore Database → **Rules** tab → delete what's there, paste the whole of
   [`firestore.rules`](firestore.rules) → **Publish**. (No command line needed.)
4. **Make yourself admin**: open `/admin.html` on your site, sign in. It shows *“This account isn’t an admin”* and your user ID.
   Firestore → **Start collection** `admins` → Document ID = your user ID → add a field `name` = your name → Save. Reload.
5. **Load products**: admin page → Products & stock → **Import from products.json** (tap twice). Then fill in **Shop details**.
6. **Publish**: GitHub repo → Settings → Pages → Source: **GitHub Actions**.

### Free plan: what to know
- Customers' browsers write orders directly, so the rules only accept a new order in the exact expected shape
  (status *New*, pay on delivery, limited sizes). Always confirm the price on WhatsApp before delivering — as you do now.
- The free plan allows about 20,000 writes and 50,000 reads a day — far more than a small shop needs.

## What's where
| File | What it does |
|---|---|
| `assets/firebase-config.js` | Your Firebase project settings (paste them in — step 2) |
| `assets/live.js` | Website: live prices/stock, saves orders, runs M-Pesa checkout |
| `admin.html`, `assets/admin.js` | The admin page |
| `functions/index.js` | Server code: `createOrder`, `orderStatus`, `mpesaCallback`, `syncStock` |
| `functions/.env` | M-Pesa settings (sandbox or live, paybill or till) |
| `firestore.rules`, `storage.rules` | Who may read/write what — the main security layer |
| `.github/workflows/deploy.yml` | Rebuilds and publishes the site (on every push and every 6 hours) |

# Later: M-Pesa (paid Blaze plan)

When you're ready for M-Pesa on the site, do these steps, then set `payments: true` in `assets/firebase-config.js`.

## 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> → **Add project** → name it e.g. `nainezz-shop` (Google Analytics: optional).
2. **Upgrade to the Blaze plan** (bottom-left ⚙ → Usage and billing). Cloud Functions and photo storage need it, and Functions must be on Blaze to call Safaricom.
   A small shop normally stays inside the free allowance, but set a **budget alert** (e.g. US$5) in Google Cloud Billing so you'd hear about any surprise.
3. **Build → Firestore Database → Create database** → *production mode* → location **europe-west1** (closest well-supported region to Nairobi).
4. **Build → Authentication → Get started → Email/Password → Enable.** Then **Users → Add user** with your email and a strong password.
   Under **Authentication → Settings → Authorized domains** add `nainezz.github.io` and `nainezz.co.ke`.
5. **Build → Storage → Get started** (production mode, same location).

## 2. Connect the website
1. **Project settings → General → Your apps → Web (`</>`)** → register an app (no hosting).
2. Copy the `firebaseConfig` values into `assets/firebase-config.js` (keep `functionsRegion: "europe-west1"`).
   These values are public by design; the rules files are what protect your data.

## 3. Deploy the rules and server code
On your computer (needs Node.js 20+):
```bash
npm install -g firebase-tools
firebase login
cd nainezz-shop
firebase use --add            # pick your project, alias "default"
cd functions && npm install && cd ..
```
Set the M-Pesa secrets (start with the **sandbox** keys from step 5):
```bash
firebase functions:secrets:set MPESA_CONSUMER_KEY
firebase functions:secrets:set MPESA_CONSUMER_SECRET
firebase functions:secrets:set MPESA_PASSKEY
firebase functions:secrets:set MPESA_CALLBACK_KEY     # make up a long random string, e.g. from: openssl rand -hex 24
```
Deploy:
```bash
firebase deploy --only firestore,storage,functions
```

## 4. Make yourself admin and load the products
1. Open `https://YOUR-SITE/admin.html` and sign in with the user from step 1.4.
   It will say *“This account isn’t an admin”* and show your user ID — copy it.
2. Firebase console → **Firestore → Start collection** → ID `admins` → Document ID: *paste your user ID* → add any field (e.g. `name` = `Yussuf`) → Save.
3. Reload the admin page → **Products & stock → Import from products.json** (tap twice). Your current products are now in Firebase.
4. Fill in **Shop details** (real phone, WhatsApp number, address, hours).

## 5. M-Pesa (Daraja)
1. Create an account at <https://developer.safaricom.co.ke> → **My Apps → Add app** (tick *Lipa Na M-Pesa Sandbox*).
2. Use the app's **Consumer Key / Secret**, and the sandbox **passkey** for shortcode `174379` (shown under *APIs → M-Pesa Express → Simulate*), in step 3.
3. Test on the site with the M-Pesa option and a sandbox test phone number. The order should turn **Paid** in the admin page.
4. **Going live**: apply for *Lipa Na M-Pesa Online* on your paybill/till through the Daraja portal ("Go Live"). Safaricom gives you live keys and a passkey. Then:
   - set the live secrets again with `firebase functions:secrets:set …`
   - in `functions/.env` set `MPESA_ENV=production`, `MPESA_SHORTCODE=` your paybill (or store number), and for a till `MPESA_TYPE=till` + `MPESA_PARTYB=` your till number
   - `firebase deploy --only functions`

## 6. Publishing the website
GitHub → repo **Settings → Pages → Source: GitHub Actions**. The workflow then:
- rebuilds and publishes on every push,
- rebuilds every 6 hours so products added in the admin page get their own pages and appear in Google,
- can be run any time: **Actions → Build and publish site → Run workflow**.

Price, stock and "on sale" changes show on the site immediately, without waiting for a rebuild.

## How payments are kept safe
- Prices are always taken from the database by the server — a customer can't change the price in their browser.
- Stock is checked before an order is accepted, and taken off only when an order is Paid or Delivered (put back if Cancelled).
- The M-Pesa callback address contains a secret key, and the server **double-checks every payment with Safaricom** (STK query) and compares the amount before marking an order Paid.
- Customers can only see the status of their own order (each order has a secret token).
- Max 5 orders per phone number in 10 minutes.
- Only accounts listed in `admins` can see orders or change products; admins can only change an order's status.

## Day to day
- **Orders tab**: new orders appear live. Set the status as you go: New → Paid → Delivered (or Cancelled).
- **Products tab**: type a new stock number or untick *On sale*; click **Edit** for prices, options, specs and photos.
- **Logs** if something fails: `firebase functions:log` or Firebase console → Functions → Logs.
