# Nainezz Phone Shop

Multi-page website for the Nainezz phone shop in Nairobi — phones, tablets, laptops, audio, smartwatches and accessories, with ordering on WhatsApp.

## Pages
- **Home** — hero slider, visit-the-shop bar, category and brand tiles, deals carousel, Power Picks tabs, a section per category, popular searches
- **Category pages** (`category/…`) — with brand filter, search and sorting; the header menu links straight to a brand within a category
- **Brand pages** (`brand/…`)
- **Product pages** (`product/…`) — storage/size options with their own prices, WhatsApp order, add to cart, call to order, specifications, related products
- **Shop** (all products + site search), **Deals**, **Cart** (sends the full order on WhatsApp), **Trade in**, **Contact** (delivery and returns policies), **404**
- `sitemap.xml` and `robots.txt` for Google

## How to update products, prices or contact details
Everything comes from **`data/products.json`**:
- `site` — shop name, phone number, WhatsApp number (`wa`: country code first, no `+`), email, address, hours, map link
- `categories` — the menu categories
- `products` — each product: `variants` is a list of `[option, price]` or `[option, price, old price]`
- `slides` — the home page banner
- `popular` — popular search links

Then rebuild the pages and commit:

```bash
python3 build.py
git add -A && git commit -m "Update products" && git push
```

No packages needed — plain Python 3.

### Real product photos
Put photos in an `images/` folder and add `"image": "images/iphone-16-pro-max.jpg"` to the product. Pages use the photo instead of the drawing.

## Backend (Firebase)
Orders, live stock and the admin page (`/admin.html`) run on Firebase; M-Pesa payments run on Cloudflare Pages Functions (`functions/api`). Setup steps: **[BACKEND.md](BACKEND.md)**. Until Firebase is connected, the site works on its own and orders go to WhatsApp.

## Security
- Static site: no server, database, login or payments to attack — orders go through WhatsApp.
- Content Security Policy on every page: only the site's own scripts can run.
- All shop text is escaped when pages are built; the cart and forms write text with `textContent`, never as HTML.
- Cart data read back from the browser is checked and capped before use.
- Turn on **Enforce HTTPS** in GitHub Pages once the domain is connected.

## Hosting
**Cloudflare Pages** (free, allows business sites): build command `python3 build.py --from-firebase --out _site`, output `_site`, env `PYTHON_VERSION=3.12`. Every push to `main` rebuilds; `.github/workflows/rebuild.yml` also rebuilds every 6 hours through a deploy hook so products added in the admin page get their own pages.
