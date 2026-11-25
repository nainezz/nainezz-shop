#!/usr/bin/env python3
"""Builds every page of the Nainezz shop from data/products.json.

Edit data/products.json (products, prices, phone number, address), then run:
    python3 build.py
and commit the result. No packages needed — plain Python 3.

Once Firebase is set up, products and shop details can come from the admin page instead:
    python3 build.py --from-firebase          # read products + settings from Firestore
    python3 build.py --from-firebase --out _site   # write the site to another folder (used by GitHub Actions)
If Firebase is not configured or can't be reached, the build falls back to data/products.json.
"""
import html
import json
import os
import re
import shutil
import sys
import urllib.request
from urllib.parse import quote

ROOT = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[1:]
OUT = os.path.abspath(ARGS[ARGS.index("--out") + 1]) if "--out" in ARGS else ROOT
D = json.load(open(os.path.join(ROOT, "data", "products.json"), encoding="utf-8"))


# ---------- optional: live data from Firestore (public read, no keys needed) ----------
def fs_val(v):
    if "stringValue" in v: return v["stringValue"]
    if "integerValue" in v: return int(v["integerValue"])
    if "doubleValue" in v: return float(v["doubleValue"])
    if "booleanValue" in v: return v["booleanValue"]
    if "nullValue" in v: return None
    if "timestampValue" in v: return v["timestampValue"]
    if "arrayValue" in v: return [fs_val(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v: return {k: fs_val(x) for k, x in v["mapValue"].get("fields", {}).items()}
    return None


def fs_get(url):
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.load(r)


def from_firebase():
    cfg = open(os.path.join(ROOT, "assets", "firebase-config.js"), encoding="utf-8").read()
    m = re.search(r'projectId:\s*"([a-z0-9-]+)"', cfg)
    if not m or m.group(1) == "your-project-id":
        print("Firebase not configured (assets/firebase-config.js) - using data/products.json")
        return
    base = f"https://firestore.googleapis.com/v1/projects/{m.group(1)}/databases/(default)/documents"
    try:
        docs, token = [], ""
        while True:
            j = fs_get(f"{base}/products?pageSize=300" + (f"&pageToken={quote(token)}" if token else ""))
            docs += j.get("documents", [])
            token = j.get("nextPageToken", "")
            if not token:
                break
        try:
            site = {k: fs_val(v) for k, v in fs_get(f"{base}/settings/site").get("fields", {}).items()}
            D["site"].update({k: v for k, v in site.items() if isinstance(v, str) and v.strip()})
        except Exception:
            pass
    except Exception as ex:
        print(f"Could not read Firestore ({ex}) - using data/products.json")
        return
    prods = []
    for d in docs:
        f = {k: fs_val(v) for k, v in d.get("fields", {}).items()}
        if f.get("active") is False or not f.get("variants"):
            continue
        variants = []
        for v in f["variants"]:
            if not isinstance(v, dict) or not v.get("price"):
                continue
            row = [str(v.get("label") or "Standard"), int(v["price"])]
            if v.get("was") and int(v["was"]) > int(v["price"]):
                row.append(int(v["was"]))
            variants.append(row)
        if not variants or f.get("cat") not in {c["slug"] for c in D["categories"]}:
            continue
        prods.append({"slug": d["name"].rsplit("/", 1)[-1], "name": f.get("name", ""), "brand": f.get("brand") or "Other",
                      "cat": f["cat"], "art": f.get("art") if f.get("art") in SHAPES else "phone", "color": f.get("color") or "#9fb7d6",
                      "badge": f.get("badge") or None, "picks": f.get("picks") or [], "variants": variants,
                      "desc": f.get("desc", ""), "specs": f.get("specs") or {}, "image": f.get("image") or None,
                      "_order": f.get("order", 9999)})
    if prods:
        prods.sort(key=lambda p: (p["_order"] if isinstance(p["_order"], (int, float)) else 9999, p["name"]))
        D["products"] = prods
        known = {p["slug"] for p in prods}
        D["slides"] = [s for s in D["slides"] if s["slug"] in known] or [
            {"slug": p["slug"], "tag": "New in store", "title": p["name"], "text": p["desc"]} for p in prods[:3]]
        print(f"Loaded {len(prods)} products from Firebase")
    else:
        print("Firestore has no products yet - using data/products.json")



def e(s):
    return html.escape(str(s), quote=True)


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def ksh(n):
    return f"KSh {n:,}"


def wa(msg):
    return f"https://wa.me/{S['wa']}?text={quote(msg)}"


CSP = ("default-src 'self'; script-src 'self' https://www.gstatic.com; style-src 'self' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; img-src 'self' data: https://firebasestorage.googleapis.com; "
       "connect-src 'self' https://firestore.googleapis.com https://firebasestorage.googleapis.com https://identitytoolkit.googleapis.com "
       "https://securetoken.googleapis.com https://firebaseinstallations.googleapis.com https://*.cloudfunctions.net https://*.run.app; "
       "frame-src https://*.firebaseapp.com; object-src 'none'; base-uri 'self'; form-action 'self'")

# ---------- product pictures (drawn, until you add real photos) ----------
SHAPES = {
    "phone": '<rect x="30" y="6" width="40" height="80" rx="9" fill="#1b1d22"/><rect x="33" y="9" width="34" height="74" rx="7" fill="{c}"/><rect x="33" y="9" width="34" height="74" rx="7" fill="url(#sh)"/><rect x="44" y="12" width="12" height="3.5" rx="1.75" fill="#1b1d22"/>',
    "tablet": '<rect x="14" y="14" width="72" height="62" rx="7" fill="#1b1d22"/><rect x="18" y="18" width="64" height="54" rx="4" fill="{c}"/><rect x="18" y="18" width="64" height="54" rx="4" fill="url(#sh)"/>',
    "laptop": '<rect x="20" y="16" width="60" height="42" rx="4" fill="#1b1d22"/><rect x="23" y="19" width="54" height="36" rx="2" fill="{c}"/><rect x="23" y="19" width="54" height="36" rx="2" fill="url(#sh)"/><path d="M10 60h80l-5 8H15z" fill="{c}"/><path d="M10 60h80l-5 8H15z" fill="#000" opacity=".2"/>',
    "buds": '<rect x="26" y="34" width="48" height="40" rx="14" fill="{c}" stroke="#bbb"/><path d="M26 48h48" stroke="#aaa"/><circle cx="50" cy="58" r="2" fill="#888"/>',
    "speaker": '<rect x="12" y="34" width="76" height="32" rx="16" fill="{c}"/><rect x="12" y="34" width="76" height="32" rx="16" fill="url(#sh)"/><circle cx="50" cy="50" r="8" fill="#fff" opacity=".5"/>',
    "watch": '<rect x="38" y="8" width="24" height="76" rx="6" fill="#444a55"/><rect x="30" y="26" width="40" height="40" rx="11" fill="#1b1d22"/><rect x="34" y="30" width="32" height="32" rx="8" fill="{c}"/><rect x="34" y="30" width="32" height="32" rx="8" fill="url(#sh)"/>',
    "charger": '<rect x="34" y="30" width="32" height="38" rx="6" fill="{c}" stroke="#bbb"/><rect x="40" y="18" width="5" height="14" fill="#999"/><rect x="55" y="18" width="5" height="14" fill="#999"/><rect x="44" y="56" width="12" height="4" rx="2" fill="#777"/>',
    "bank": '<rect x="26" y="14" width="48" height="70" rx="10" fill="{c}"/><rect x="26" y="14" width="48" height="70" rx="10" fill="url(#sh)"/><g fill="#5bd18b"><rect x="36" y="66" width="5" height="5" rx="1"/><rect x="44" y="66" width="5" height="5" rx="1"/><rect x="52" y="66" width="5" height="5" rx="1"/></g>',
    "tag": '<circle cx="50" cy="48" r="28" fill="{c}" stroke="#ccc"/><circle cx="50" cy="48" r="28" fill="url(#sh)"/><circle cx="50" cy="48" r="9" fill="#d9dbe0"/>',
    "case": '<rect x="30" y="6" width="40" height="80" rx="10" fill="{c}" opacity=".85"/><rect x="36" y="12" width="14" height="16" rx="4" fill="#1b1d22"/>',
}
if "--from-firebase" in ARGS:
    from_firebase()
S, CATS, P = D["site"], D["categories"], D["products"]
CAT = {c["slug"]: c for c in CATS}
BY = {p["slug"]: p for p in P}
for p in P:  # derived fields
    v = p["variants"][0]
    p["price"], p["was"] = v[1], (v[2] if len(v) > 2 else None)
    p["from"] = len(p["variants"]) > 1
    p.setdefault("picks", [])
    p["url"] = f"product/{p['slug']}.html"
BRANDS = []
for p in P:
    if p["brand"] not in BRANDS:
        BRANDS.append(p["brand"])

DEFS = '<defs><linearGradient id="sh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient></defs>'


def shape(kind, color):
    return DEFS + '<ellipse cx="50" cy="88" rx="34" ry="3" fill="#000" opacity=".15"/>' + SHAPES[kind].replace("{c}", e(color))


def pic(p, R, cls=""):
    """Real photo if the product has "image": "images/xyz.jpg", otherwise the drawing."""
    if p.get("image"):
        src = p["image"] if str(p["image"]).startswith("https://") else R + p["image"]
        return f'<img class="{cls}" src="{e(src)}" alt="{e(p["name"])}" loading="lazy">'
    return f'<svg class="{cls}" viewBox="0 0 100 92" role="img" aria-label="{e(p["name"])}">{shape(p["art"], p["color"])}</svg>'


LOGO = ('<svg viewBox="0 0 26 24" aria-hidden="true"><rect x="0" y="16" width="5" height="8" rx="1.5" fill="#2f5bff"/>'
        '<rect x="7" y="11" width="5" height="13" rx="1.5" fill="#2f5bff"/><rect x="14" y="6" width="5" height="18" rx="1.5" fill="#2f5bff"/>'
        '<rect x="21" y="0" width="5" height="24" rx="1.5" fill="currentColor"/></svg>')
WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.6-.3.4c-.1.1-.3.3-.1.6.2.3.7 1.2 1.6 2 1.1 1 2 1.3 2.3 1.4.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.1.1.6-.1 1.2z"/></svg>'
PHONE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/></svg>'
CART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></g></svg>'


# ---------- shared pieces ----------
def card(p, R):
    off = round((1 - p["price"] / p["was"]) * 100) if p["was"] else 0
    badge = f'<span class="badge{" new" if p.get("badge") == "NEW" else ""}">{e(p["badge"])}</span>' if p.get("badge") else ""
    price = (f'<span class="from">From</span> ' if p["from"] else "") + ksh(p["price"])
    if p["was"]:
        price += f'<s class="was">{ksh(p["was"])}</s><span class="off">−{off}%</span>'
    v = p["variants"][0][0]
    words = " ".join([p["name"], p["brand"], CAT[p["cat"]]["name"], " ".join(x[0] for x in p["variants"])]).lower()
    msg = f"Hi {S['name']}, I would like to order: {p['name']} ({v}) – {ksh(p['price'])}. Is it available?"
    return f'''<article class="card" data-slug="{p['slug']}" data-n="{e(words)}" data-b="{e(p['brand'])}" data-c="{p['cat']}" data-p="{p['price']}" data-d="{off}">
{badge}<a class="pic" href="{R}{p['url']}" tabindex="-1" aria-hidden="true">{pic(p, R)}</a>
<h3><a href="{R}{p['url']}">{e(p['name'])}</a></h3>
<div class="price">{price}</div>
<div class="meta"><span class="stk">In stock</span><span>Genuine</span><span>Same-day delivery</span></div>
<div class="acts"><a class="wa" href="{e(wa(msg))}" target="_blank" rel="noopener">{WA_ICON}Order on WhatsApp</a>
<button type="button" data-add="{p['slug']}" data-name="{e(p['name'])}" data-variant="{e(v)}" data-price="{p['price']}">Add to cart</button></div>
<a class="call" href="tel:{S['phone_tel']}">or call to order: {e(S['phone_display'])}</a>
</article>'''


def grid(items, R):
    return '<div class="grid">' + "".join(card(p, R) for p in items) + "</div>"


def row(items, R, rid):
    return (f'<div class="rowwrap"><div class="row" id="{rid}">' + "".join(card(p, R) for p in items) + "</div>"
            f'<button class="rb prev" data-scroll="{rid}" data-dir="-1" aria-label="Scroll back">‹</button>'
            f'<button class="rb next" data-scroll="{rid}" data-dir="1" aria-label="Scroll forward">›</button></div>')


def sechd(title, sub="", link=None):
    a = f'<a class="more" href="{link[0]}">{e(link[1])} →</a>' if link else ""
    s = f"<p>{e(sub)}</p>" if sub else ""
    return f'<div class="sechd"><div><h2>{e(title)}</h2>{s}</div>{a}</div>'


def filter_tools(items, R, show_brands=True, show_cats=False):
    chips = ""
    if show_brands:
        bs = [b for b in BRANDS if any(p["brand"] == b for p in items)]
        if len(bs) > 1:
            chips += '<div class="chips scroll" role="group" aria-label="Brand"><button type="button" data-fb="" aria-pressed="true">All brands</button>' + "".join(
                f'<button type="button" data-fb="{e(b)}" aria-pressed="false">{e(b)}</button>' for b in bs) + "</div>"
    if show_cats:
        chips += '<div class="chips scroll" role="group" aria-label="Category"><button type="button" data-fc="" aria-pressed="true">All</button>' + "".join(
            f'<button type="button" data-fc="{c["slug"]}" aria-pressed="false">{e(c["name"])}</button>' for c in CATS) + "</div>"
    return f'''<div class="tools">
<label class="fq"><span class="sr">Search these products</span><input id="fq" type="search" placeholder="Search these products" autocomplete="off"></label>
<label class="sort">Sort <select id="sort"><option value="">Featured</option><option value="lo">Price: low to high</option><option value="hi">Price: high to low</option><option value="off">Biggest discount</option></select></label>
</div>{chips}
<p class="count" id="fcount" aria-live="polite">{len(items)} products</p>
<div class="grid" id="pgrid">{"".join(card(p, R) for p in items)}</div>
<div class="empty" id="noRes" hidden>Nothing matches that. <a id="askWa" href="{e(wa("Hi " + S["name"] + ", do you have:"))}" target="_blank" rel="noopener">Ask us on WhatsApp</a> — we can often get it.</div>'''


def page(path, title, desc, body, active=None, extra_head="", body_attr=""):
    depth = path.count("/")
    R = "../" * depth
    nav = ""
    for c in CATS:
        subs = [b for b in BRANDS if any(p["brand"] == b and p["cat"] == c["slug"] for p in P)]
        dd = "".join(f'<li><a href="{R}category/{c["slug"]}.html?brand={quote(b)}">{e(b)}</a></li>' for b in subs)
        cur = ' aria-current="page"' if active == c["slug"] else ""
        nav += f'<li class="dd"><a href="{R}category/{c["slug"]}.html"{cur}>{e(c["name"])}</a><ul>{dd}<li><a href="{R}category/{c["slug"]}.html">All {e(c["name"].lower())}</a></li></ul></li>'
    for slug, label in (("deals", "Deals"), ("trade-in", "Trade in"), ("contact", "Contact us")):
        cur = ' aria-current="page"' if active == slug else ""
        nav += f'<li><a href="{R}{slug}.html"{cur}>{label}</a></li>'
    foot_cats = "".join(f'<li><a href="{R}category/{c["slug"]}.html">{e(c["name"])}</a></li>' for c in CATS)
    hello = wa(f"Hi {S['name']}, I have a question.")
    out = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{CSP}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{S['domain']}/{'' if path == 'index.html' else path}">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}"><meta property="og:type" content="website">
<meta name="theme-color" content="#15161b">
<link rel="icon" href="{R}assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800;900&amp;family=Inter:wght@400;500;600;700&amp;display=swap">
<link rel="stylesheet" href="{R}assets/style.css">
{extra_head}</head>
<body data-root="{R}" data-wa="{S['wa']}" data-shop="{e(S['name'])}"{body_attr}>
<a class="skip" href="#main">Skip to content</a>
<div class="top"><div class="wrap"><span>Genuine devices with warranty</span><span>Same-day delivery in Nairobi</span><span>7-day returns on faulty items</span><span class="tr"><a href="tel:{S['phone_tel']}">{e(S['phone_display'])}</a> · <a href="{e(hello)}" target="_blank" rel="noopener">WhatsApp</a> · {e(S['address'].split('(')[0].strip())}</span></div></div>
<header class="site">
<div class="wrap hd">
<a class="logo" href="{R}index.html" aria-label="{e(S['name'])} home">{LOGO}{e(S['name'].lower())}</a>
<form class="search" action="{R}shop.html" method="get" role="search"><input name="q" type="search" placeholder="Search phones, laptops, earbuds…" aria-label="Search products" autocomplete="off"><button type="submit">Search</button></form>
<a class="hbtn call" href="tel:{S['phone_tel']}">{PHONE_ICON}<span>Call us</span></a>
<a class="hbtn ask" href="{e(hello)}" target="_blank" rel="noopener">{WA_ICON}<span>Ask a question</span></a>
<a class="hbtn cart" href="{R}cart.html" aria-label="Cart">{CART_ICON}<span>Cart</span><i data-cart-count>0</i></a>
</div>
<nav class="cats" aria-label="Categories"><ul class="wrap scroll">{nav}</ul></nav>
</header>
<main id="main">
{body}
</main>
<footer class="site"><div class="wrap">
<div class="cols">
<div><a class="logo" href="{R}index.html">{LOGO}{e(S['name'].lower())}</a><p>Phones, tablets, laptops and accessories in Nairobi. Order online, on WhatsApp, or walk in and test before you buy.</p></div>
<div><h3>Shop</h3><ul>{foot_cats}<li><a href="{R}deals.html">Deals</a></li><li><a href="{R}shop.html">All products</a></li></ul></div>
<div><h3>Help</h3><ul><li><a href="{R}contact.html#delivery">Delivery &amp; pickup</a></li><li><a href="{R}contact.html#returns">Returns &amp; warranty</a></li><li><a href="{R}trade-in.html">Trade in your phone</a></li><li><a href="{R}contact.html">Contact us</a></li></ul></div>
<div><h3>Visit us</h3><ul><li>{e(S['address'])}</li><li>{e(S['hours'])}</li><li><a href="tel:{S['phone_tel']}">{e(S['phone_display'])}</a></li><li><a href="mailto:{e(S['email'])}">{e(S['email'])}</a></li></ul></div>
</div>
<div class="legal"><span>© 2026 {e(S['name'])}. All rights reserved.</span><span>Prices in Kenya shillings and subject to stock.</span></div>
</div></footer>
<a class="fab" href="{e(hello)}" target="_blank" rel="noopener" aria-label="Chat on WhatsApp">{WA_ICON}</a>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script src="{R}assets/app.js" defer></script>
<script type="module" src="{R}assets/live.js"></script>
</body>
</html>
'''
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(out)
    return R


def R_for(path):
    return "../" * path.count("/")


TRUST = '''<div class="trust">
<div><svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></g></svg><p><b>Genuine devices</b><small>Sealed boxes with warranty</small></p></div>
<div><svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></g></svg><p><b>Same-day delivery</b><small>Within Nairobi, order by 3pm</small></p></div>
<div><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4"/></svg><p><b>7-day returns</b><small>On faulty items</small></p></div>
<div><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/></svg><p><b>Order on WhatsApp</b><small>Pay on delivery or M-Pesa</small></p></div>
</div>'''


def crumbs(R, *items):
    parts = [f'<a href="{R}index.html">Home</a>'] + [f'<a href="{R}{u}">{e(t)}</a>' if u else f"<span aria-current=\"page\">{e(t)}</span>" for t, u in items]
    return '<nav class="crumbs" aria-label="Breadcrumb">' + '<span aria-hidden="true">/</span>'.join(parts) + "</nav>"


# ---------- clean old generated folders ----------
for d in ("category", "brand", "product"):
    shutil.rmtree(os.path.join(OUT, d), ignore_errors=True)
if OUT != ROOT:  # copy the hand-written files next to the generated pages
    os.makedirs(OUT, exist_ok=True)
    for d in ("assets", "data", "images"):
        if os.path.isdir(os.path.join(ROOT, d)):
            shutil.copytree(os.path.join(ROOT, d), os.path.join(OUT, d), dirs_exist_ok=True)
    for f in ("admin.html", "CNAME"):
        if os.path.exists(os.path.join(ROOT, f)):
            shutil.copy(os.path.join(ROOT, f), os.path.join(OUT, f))

# ---------- home ----------
R = ""
slides = ""
for i, s in enumerate(D["slides"]):
    p = BY[s["slug"]]
    slides += f'''<div class="slide" id="slide{i}" aria-roledescription="slide" aria-label="{i + 1} of {len(D['slides'])}">
<div class="stext"><span class="tag">{e(s['tag'])}</span><h1>{e(s['title'])}</h1><p>{e(s['text'])}</p>
<div class="btns"><a class="btn" href="{p['url']}">Shop now</a><a class="btn wa" href="{e(wa("Hi " + S["name"] + ", I'm interested in the " + p["name"]))}" target="_blank" rel="noopener">{WA_ICON}Order on WhatsApp</a></div></div>
<div class="sfig"><svg viewBox="0 0 400 340" aria-hidden="true"><defs><radialGradient id="glow{i}"><stop offset="0" stop-color="#2f5bff" stop-opacity=".6"/><stop offset="1" stop-color="#2f5bff" stop-opacity="0"/></radialGradient></defs>
<circle cx="200" cy="160" r="170" fill="url(#glow{i})"/><g fill="#2f5bff" opacity=".35"><rect x="300" y="210" width="16" height="40" rx="4"/><rect x="322" y="180" width="16" height="70" rx="4"/><rect x="344" y="150" width="16" height="100" rx="4"/><rect x="366" y="120" width="16" height="130" rx="4" fill="#fff"/></g>
<ellipse cx="200" cy="300" rx="120" ry="16" fill="#000" opacity=".45"/><rect x="100" y="282" width="200" height="18" rx="9" fill="#2a2d36"/><g transform="translate(70,20) scale(2.6)">{shape(p['art'], p['color'])}</g></svg></div></div>'''
dots = "".join(f'<button type="button" data-go="{i}" aria-label="Slide {i + 1}"{' aria-current="true"' if i == 0 else ""}></button>' for i in range(len(D["slides"])))
cat_tiles = "".join(
    f'<a class="ctile" href="category/{c["slug"]}.html"><svg viewBox="0 0 100 92" aria-hidden="true">{shape(c["art"], c["color"])}</svg><b>{e(c["name"])}</b><small>{sum(1 for p in P if p["cat"] == c["slug"])} products</small></a>'
    for c in CATS)
brand_tiles = "".join(f'<a class="btile" href="brand/{slugify(b)}.html">{e(b)}</a>' for b in BRANDS)
tabs = [("top", "Top phones"), ("creator", "Creator picks"), ("budget", "Budget picks")]
tab_btns = "".join(f'<button type="button" role="tab" id="t-{k}" aria-controls="p-{k}" aria-selected="{str(i == 0).lower()}">{e(l)}</button>' for i, (k, l) in enumerate(tabs))
tab_panels = "".join(f'<div role="tabpanel" id="p-{k}" aria-labelledby="t-{k}"{"" if i == 0 else " hidden"}>{row([p for p in P if k in p["picks"]], R, "pk-" + k)}</div>' for i, (k, l) in enumerate(tabs))
cat_sections = ""
for c in CATS:
    items = [p for p in P if p["cat"] == c["slug"]][:8]
    if not items:
        continue
    cat_sections += f'<section class="band">{sechd(c["name"], c["blurb"], ("category/" + c["slug"] + ".html", "View all"))}{grid(items, R)}</section>'
popular = "".join(f'<a href="shop.html?q={quote(q)}">{e(q)}</a>' for q in D["popular"])
deals = [p for p in P if p["was"]]
home = f'''<section class="hero" aria-label="Featured" aria-roledescription="carousel">
<div class="slides" id="slides">{slides}</div>
<div class="hctl"><button type="button" class="hprev" aria-label="Previous slide">‹</button><div class="dots">{dots}</div><button type="button" class="hnext" aria-label="Next slide">›</button></div>
</section>
<div class="wrap">
<section class="visitbar"><div><b>Visit the shop</b> · {e(S['address'])} · {e(S['hours'])}</div><div class="btns"><a class="btn sm ghostd" href="{e(S['map_link'])}" target="_blank" rel="noopener">Get directions</a><a class="btn sm" href="tel:{S['phone_tel']}">Call {e(S['phone_display'])}</a></div></section>
<section class="band">{TRUST}</section>
<section class="band">{sechd("Shop by category")}<div class="ctiles">{cat_tiles}</div></section>
<section class="band">{sechd("Shop by brand")}<div class="btiles">{brand_tiles}</div></section>
<section class="band">{sechd("Deals of the week", "Limited stock at these prices.", ("deals.html", "All deals"))}{row(deals, R, "dealrow")}</section>
<section class="band">{sechd("Power picks")}<div class="tabs" role="tablist" aria-label="Power picks">{tab_btns}</div>{tab_panels}</section>
{cat_sections}
<section class="band">{sechd("Popular searches")}<div class="popular">{popular}</div></section>
</div>'''
page("index.html", f"{S['name']} — Phones, Laptops & Accessories in Nairobi",
     "Genuine smartphones, tablets, laptops, earbuds and accessories in Nairobi. Same-day delivery, order on WhatsApp.", home)

# ---------- listing pages ----------
def listing(path, title, h1, blurb, items, crumb, active=None, brands=True, cats=False):
    R = R_for(path)
    body = f'''<div class="wrap">{crumbs(R, *crumb)}
<section class="phead"><h1>{e(h1)}</h1><p>{e(blurb)}</p></section>
{filter_tools(items, R, brands, cats)}</div>'''
    page(path, title, blurb, body, active)


for c in CATS:
    items = [p for p in P if p["cat"] == c["slug"]]
    listing(f"category/{c['slug']}.html", f"{c['name']} in Nairobi — {S['name']}", c["name"], c["blurb"], items, ((c["name"], None),), c["slug"])
for b in BRANDS:
    items = [p for p in P if p["brand"] == b]
    listing(f"brand/{slugify(b)}.html", f"{b} in Nairobi — {S['name']}", b, f"Genuine {b} products with warranty and same-day delivery in Nairobi.", items, (("Brands", None), (b, None)), None, False, True)
listing("shop.html", f"All products — {S['name']}", "All products", "Everything in stock, with prices in Kenya shillings.", P, (("All products", None),), None, True, True)
listing("deals.html", f"Deals of the week — {S['name']}", "Deals of the week", "Reduced prices while stock lasts.", deals, (("Deals", None),), "deals")

# ---------- product pages ----------
for p in P:
    path = f"product/{p['slug']}.html"
    R = R_for(path)
    c = CAT[p["cat"]]
    vbtns = ""
    if len(p["variants"]) > 1:
        vbtns = '<div class="vars" role="group" aria-label="Choose option">' + "".join(
            f'<button type="button" class="var" data-label="{e(v[0])}" data-price="{v[1]}" data-was="{v[2] if len(v) > 2 else ""}" aria-pressed="{str(i == 0).lower()}"><b>{e(v[0])}</b><small>{ksh(v[1])}</small></button>'
            for i, v in enumerate(p["variants"])) + "</div>"
    v0 = p["variants"][0]
    off = round((1 - p["price"] / p["was"]) * 100) if p["was"] else 0
    was = f'<s class="was" id="pWas">{ksh(p["was"])}</s><span class="off" id="pOff">−{off}%</span>' if p["was"] else '<s class="was" id="pWas" hidden></s><span class="off" id="pOff" hidden></span>'
    specs = "".join(f"<tr><th scope=\"row\">{e(k)}</th><td>{e(v)}</td></tr>" for k, v in p["specs"].items())
    related = [x for x in P if x["cat"] == p["cat"] and x is not p][:4] or [x for x in P if x is not p][:4]
    base_msg = f"Hi {S['name']}, I would like to order: {p['name']}"
    ld = json.dumps({"@context": "https://schema.org", "@type": "Product", "name": p["name"], "brand": {"@type": "Brand", "name": p["brand"]},
                     "description": p["desc"], "offers": {"@type": "Offer", "priceCurrency": "KES", "price": p["price"],
                     "availability": "https://schema.org/InStock", "url": f"{S['domain']}/{path}"}}).replace("</", "<\\/")
    body = f'''<div class="wrap">{crumbs(R, (c["name"], f"category/{c['slug']}.html"), (p["name"], None))}
<section class="pd">
<div class="gallery">{('<span class="badge' + (' new' if p.get('badge') == 'NEW' else '') + '">' + e(p['badge']) + '</span>') if p.get('badge') else ''}{pic(p, R, "big")}</div>
<div class="pinfo">
<a class="brandlink" href="{R}brand/{slugify(p['brand'])}.html">{e(p['brand'])}</a>
<h1>{e(p['name'])}</h1>
<p class="lede">{e(p['desc'])}</p>
<div class="pprice"><span id="pPrice">{ksh(p['price'])}</span>{was}</div>
{vbtns}
<ul class="assure"><li id="pStock">In stock in Nairobi</li><li>Genuine, sealed, with warranty</li><li>Same-day delivery in Nairobi · pickup in shop</li><li>Pay on delivery or by M-Pesa</li></ul>
<div class="pacts">
<a class="btn wa big" id="pWa" data-msg="{e(base_msg)}" href="{e(wa(base_msg + f' ({v0[0]}) – {ksh(p["price"])}. Is it available?'))}" target="_blank" rel="noopener">{WA_ICON}Order on WhatsApp</a>
<button type="button" class="btn big alt" id="pAdd" data-add="{p['slug']}" data-name="{e(p['name'])}" data-variant="{e(v0[0])}" data-price="{p['price']}">Add to cart</button>
<a class="btn big ghostd" href="tel:{S['phone_tel']}">{PHONE_ICON}Call to order</a>
</div>
</div>
</section>
<section class="band"><h2>Specifications</h2><table class="specs"><tbody>{specs}</tbody></table></section>
<section class="band">{sechd("You may also like", "", (f"{R}category/{c['slug']}.html", "More " + c['name'].lower()))}{grid(related, R)}</section>
</div>'''
    page(path, f"{p['name']} price in Kenya — {S['name']}", f"{p['name']} from {ksh(p['price'])} in Nairobi. {p['desc']}", body, p["cat"],
         f'<script type="application/ld+json">{ld}</script>\n', f' data-product="{p["slug"]}"')

# ---------- cart ----------
cart = f'''<div class="wrap">{crumbs("", ("Cart", None))}
<section class="phead"><h1>Your cart</h1><p>Send your order on WhatsApp — we confirm stock, delivery time and payment there.</p></section>
<div class="cartgrid">
<div id="cartLines" class="cartlines"><p class="empty">Loading your cart…</p></div>
<form class="panel" id="checkoutForm" novalidate>
<h2>Order details</h2>
<label>Your name<input name="name" autocomplete="name" maxlength="60"></label>
<label>Phone number<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="e.g. 0712 345 678" maxlength="16"></label>
<label>Delivery area or pickup<input name="area" placeholder="e.g. Westlands, or pickup in shop" maxlength="100"></label>
<label>Notes (optional)<textarea name="notes" rows="3" maxlength="300" placeholder="Colour, best time to call…"></textarea></label>
<fieldset class="pay" id="payChoice" hidden><legend>How would you like to pay?</legend>
<label class="opt"><input type="radio" name="pay" value="mpesa" checked><span><b>Pay now with M-Pesa</b><small>We send a payment prompt to your phone</small></span></label>
<label class="opt"><input type="radio" name="pay" value="whatsapp"><span><b>Pay on delivery</b><small>Confirm your order with us on WhatsApp</small></span></label>
</fieldset>
<div class="tot"><span>Total</span><span id="cartTotal">KSh 0</span></div>
<p class="err" id="checkoutErr" hidden></p>
<button class="btn wa big" type="submit" id="checkoutBtn">{WA_ICON}<span id="checkoutLabel">Send order on WhatsApp</span></button>
<div class="ostatus" id="orderStatus" role="status" aria-live="polite" hidden></div>
<a class="btn ghostd big" href="tel:{S['phone_tel']}">Or call {e(S['phone_display'])}</a>
<p class="fine">Pay on delivery or by M-Pesa after we confirm. Delivery is free within Nairobi CBD.</p>
</form>
</div></div>'''
page("cart.html", f"Cart — {S['name']}", "Your cart. Send your order on WhatsApp.", cart)

# ---------- trade-in ----------
trade = f'''<div class="wrap">{crumbs("", ("Trade in", None))}
<section class="phead"><h1>Trade in your old phone</h1><p>Tell us what you have. We'll send an offer on WhatsApp, and you can put it towards a new device.</p></section>
<div class="twocol">
<form class="panel" data-wa-form="Trade-in request" novalidate>
<label>Phone you have<input name="Device" required placeholder="e.g. iPhone 13 Pro" maxlength="80"></label>
<label>Storage<select name="Storage"><option>64GB</option><option selected>128GB</option><option>256GB</option><option>512GB</option><option>1TB</option></select></label>
<label>Condition<select name="Condition"><option>Like new</option><option selected>Good — light scratches</option><option>Cracked screen or back</option><option>Not working</option></select></label>
<label>Battery health (if iPhone)<input name="Battery health" inputmode="numeric" placeholder="e.g. 86%" maxlength="5"></label>
<label>Phone you want<input name="Wants" placeholder="e.g. iPhone 16 Pro Max 256GB" maxlength="80"></label>
<p class="err" hidden>Please tell us which phone you have.</p>
<button class="btn wa big" type="submit">{WA_ICON}Get my offer on WhatsApp</button>
</form>
<div class="panel steps"><h2>How it works</h2><ol><li><b>Send your details</b> using the form.</li><li><b>Get an offer</b> on WhatsApp, usually the same day.</li><li><b>Bring the phone in</b> so we can check it and confirm the price.</li><li><b>Pay the difference</b> and walk out with your new device.</li></ol><p class="fine">Back up and sign out of iCloud or Google before trading in.</p></div>
</div></div>'''
page("trade-in.html", f"Trade in your phone — {S['name']}", "Trade in your old phone towards a new one in Nairobi.", trade, "trade-in")

# ---------- contact ----------
contact = f'''<div class="wrap">{crumbs("", ("Contact us", None))}
<section class="phead"><h1>Contact us</h1><p>Call, WhatsApp, email or walk in — we usually reply within minutes during shop hours.</p></section>
<div class="twocol">
<div class="panel"><h2>Visit the shop</h2>
<dl class="dl"><dt>Address</dt><dd>{e(S['address'])}</dd><dt>Hours</dt><dd>{e(S['hours'])}</dd><dt>Phone</dt><dd><a href="tel:{S['phone_tel']}">{e(S['phone_display'])}</a></dd><dt>Email</dt><dd><a href="mailto:{e(S['email'])}">{e(S['email'])}</a></dd></dl>
<div class="btns"><a class="btn" href="{e(S['map_link'])}" target="_blank" rel="noopener">Get directions</a><a class="btn wa" href="{e(wa("Hi " + S["name"] + ", I have a question."))}" target="_blank" rel="noopener">{WA_ICON}WhatsApp us</a></div></div>
<form class="panel" data-wa-form="Message from the website" novalidate><h2>Send a message</h2>
<label>Your name<input name="Name" required maxlength="60" autocomplete="name"></label>
<label>Message<textarea name="Message" required rows="5" maxlength="600"></textarea></label>
<p class="err" hidden>Please add your name and message.</p>
<button class="btn wa big" type="submit">{WA_ICON}Send on WhatsApp</button></form>
</div>
<section class="band twocol">
<div class="panel" id="delivery"><h2>Delivery &amp; pickup</h2><ul><li>Same-day delivery within Nairobi for orders confirmed by 3pm.</li><li>Countrywide delivery by courier in 1–2 days.</li><li>Free pickup in the shop — test your device before you pay.</li></ul></div>
<div class="panel" id="returns"><h2>Returns &amp; warranty</h2><ul><li>7-day returns on faulty items, with box and receipt.</li><li>New devices carry the manufacturer's warranty.</li><li>We help you with warranty claims after the 7 days.</li></ul><p class="fine">Edit these policies to match how your shop works.</p></div>
</section></div>'''
page("contact.html", f"Contact — {S['name']}", f"Call, WhatsApp or visit {S['name']} in Nairobi.", contact, "contact")

# ---------- 404 ----------
page("404.html", f"Page not found — {S['name']}", "Page not found.",
     f'<div class="wrap"><section class="phead center"><h1>Page not found</h1><p>That page has moved or no longer exists.</p><div class="btns"><a class="btn" href="/index.html">Go to the home page</a><a class="btn ghostd" href="/shop.html">Browse all products</a></div></section></div>')

# ---------- sitemap + robots ----------
urls = ["", "shop.html", "deals.html", "trade-in.html", "contact.html"] + [f"category/{c['slug']}.html" for c in CATS] + \
       [f"brand/{slugify(b)}.html" for b in BRANDS] + [p["url"] for p in P]
with open(os.path.join(OUT, "sitemap.xml"), "w", encoding="utf-8") as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
            "".join(f"  <url><loc>{S['domain']}/{u}</loc></url>\n" for u in urls) + "</urlset>\n")
with open(os.path.join(OUT, "robots.txt"), "w", encoding="utf-8") as f:
    f.write(f"User-agent: *\nAllow: /\nDisallow: /admin.html\nSitemap: {S['domain']}/sitemap.xml\n")

print(f"Built {len(P)} product pages, {len(CATS)} categories, {len(BRANDS)} brands.")
