# Nainezz Phone Shop

Website for the Nainezz phone shop in Nairobi — phones, tablets, laptops, audio and accessories, with ordering on WhatsApp.

## Features
- Category tabs, brand filter and live search
- Rotating hero banner and a "Deals of the week" row
- Cart with quantities, saved in the browser
- One-tap WhatsApp ordering per product, and a full cart order sent as one WhatsApp message
- Works on phones, light and dark mode

## Setup
Everything is in `index.html` — no build step.

1. Set your WhatsApp number in the `WA` constant at the top of the script (country code first, no `+`, e.g. `2547XXXXXXXX`).
2. Replace the placeholder phone number `0700 000 000` and the shop address in the page.
3. Edit the `P` array in the script with your real products and prices (the current ones are samples).

## Hosting
Turn on **GitHub Pages** (Settings → Pages → Deploy from branch → `main` / root), then point `nainezz.co.ke` at it with a `CNAME` record.
