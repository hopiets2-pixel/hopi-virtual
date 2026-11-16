// HOPI VIRTUAL – SEO pro vyhledávače a náhledy při sdílení (Netlify Edge Function)
//
// E-shop je jedna stránka (index.html), obsah dokresluje JavaScript. Robot bez JavaScriptu
// (Seznam, náhledy v Discordu/Facebooku, AI vyhledávače) by viděl prázdnou stránku. Tahle funkce
// proto u úvodu a u produktů doplní do HTML skutečné údaje z databáze:
//   /                 → title, popisek, seznam produktů s odkazy
//   /produkt/12-nazev → title, popisek, cena, fotka, náhled pro sdílení, Product JSON-LD
//                       (špatný nebo chybějící název v adrese → 301 na správný, neexistující → 404)
//   /sitemap.xml      → seznam stránek pro Google a Seznam
// Když cokoli selže (databáze neodpovídá…), vrátí e-shop beze změny – nikdy ho nerozbije.

const SB = "https://jaktgczqpwxhxxtqfvam.supabase.co";
const KEY = "sb_publishable_JZ14aScZgNNtFIxqMunKAg_3waSj_dU"; // veřejný klíč (stejný jako v index.html)
const SITE = "https://eshophopivirtual.com";
const DESC = "Oficiální merch HOPI VIRTUAL. Prémiové materiály, poctivá práce a rychlé doručení po celé ČR a SR.";

type Product = Record<string, any>;
type Ctx = { next: () => Promise<Response> };

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// stejné jako hvSlug() v index.html
export const slug = (s: unknown) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
export const productPath = (p: Product) => "/produkt/" + Number(p.id) + (slug(p.name) ? "-" + slug(p.name) : "");
const clip = (t: unknown, n: number) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
const price = (n: unknown) => Math.round(Number(n) || 0).toLocaleString("cs-CZ").replace(/\u00a0/g, " ");
export function stockCount(p: Product): number {
  if (p.stock === undefined || p.stock === null) return 999;
  if (typeof p.stock === "object") return Object.values(p.stock).reduce((a: number, v) => a + Math.max(0, Number(v) || 0), 0);
  return Number(p.stock) || 0;
}
const images = (p: Product): string[] => {
  const im = Array.isArray(p.images) && p.images.length ? p.images : (p.photo ? [p.photo] : []);
  return im.map(String).filter((u: string) => /^https?:\/\//i.test(u));
};

async function db(path: string): Promise<any> {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(2500) });
  if (!r.ok) throw new Error("db " + r.status);
  return await r.json();
}

// Schválená hodnocení (hopi-hodnoceni.sql → hopi_public_reviews). Chyba = bez hodnocení, stránka jede dál.
export type Review = { rating: number; comment?: string | null; name?: string; date?: string; products?: number[] };
async function publicReviews(): Promise<Review[]> {
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/hopi_public_reviews`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(1500) });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}
export const reviewsFor = (all: Review[], id: number) => all.filter((r) => Array.isArray(r.products) && r.products.map(Number).includes(Number(id)) && Number(r.rating) >= 1 && Number(r.rating) <= 5);
export function reviewLd(list: Review[]) {
  if (!list.length) return {};
  const avg = Math.round(list.reduce((s, r) => s + Number(r.rating), 0) / list.length * 10) / 10;
  return {
    aggregateRating: { "@type": "AggregateRating", ratingValue: avg, reviewCount: list.length, bestRating: 5, worstRating: 1 },
    review: list.slice(0, 10).map((r) => ({ "@type": "Review", reviewRating: { "@type": "Rating", ratingValue: Number(r.rating), bestRating: 5, worstRating: 1 },
      author: { "@type": "Person", name: String(r.name || "Zákazník") }, ...(r.date ? { datePublished: r.date } : {}), ...(r.comment ? { reviewBody: String(r.comment) } : {}) })),
  };
}

// Nahradí blok <!--seo-->…<!--/seo--> v hlavičce a obsah <div id="app"></div>
export function inject(html: string, head: string, body: string): string {
  const a = html.indexOf("<!--seo-->"), b = html.indexOf("<!--/seo-->");
  if (a < 0 || b < a) return html;
  let out = html.slice(0, a) + "<!--seo-->\n" + head + "\n" + html.slice(b);
  if (body) out = out.replace('<div id="app"></div>', `<div id="app">${body}</div>`);
  return out;
}

export function headTags(o: { title: string; desc: string; url: string; img: string; type: string; robots?: string; ld: unknown[] }) {
  return [
    `<title>${esc(o.title)}</title>`,
    `<meta name="description" content="${esc(o.desc)}">`,
    o.robots ? `<meta name="robots" content="${esc(o.robots)}">` : `<link rel="canonical" href="${esc(o.url)}">`,
    `<meta property="og:type" content="${esc(o.type)}">`,
    `<meta property="og:site_name" content="HOPI VIRTUAL">`,
    `<meta property="og:locale" content="cs_CZ">`,
    `<meta property="og:title" content="${esc(o.title)}">`,
    `<meta property="og:description" content="${esc(o.desc)}">`,
    `<meta property="og:url" content="${esc(o.url)}">`,
    `<meta property="og:image" content="${esc(o.img)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    ...o.ld.map((x, i) => `<script type="application/ld+json"${i === 0 ? ' id="hvLdSite"' : ' data-edge="1"'}>${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`),
  ].join("\n");
}

const SITE_LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": SITE + "/#org", name: "HOPI VIRTUAL", url: SITE + "/", logo: SITE + "/logo-hero.png", email: "eshophopivirtual@gmail.com" },
    { "@type": "WebSite", "@id": SITE + "/#web", name: "HOPI VIRTUAL", url: SITE + "/", inLanguage: "cs", publisher: { "@id": SITE + "/#org" } },
  ],
};
// Jednoduchý obsah pro roboty i pro první okamžik, než se načte e-shop (pak ho JavaScript nahradí)
const STATIC_CSS = `<style>.seo-static{max-width:980px;margin:0 auto;padding:120px 20px 60px;color:#e8e8e8;font-family:Archivo,system-ui,sans-serif}.seo-static h1{font-size:clamp(28px,5vw,44px);margin:0 0 12px;color:#fff}.seo-static p{color:#a8a8a8;line-height:1.6}.seo-static ul{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.seo-static li a{display:block;padding:14px 16px;border:1px solid #222;color:#fff;text-decoration:none}.seo-static li span{display:block;color:#00c853;margin-top:4px}.seo-static img{max-width:min(100%,520px);height:auto;display:block;margin:16px 0}</style>`;

export function homePage(html: string, products: Product[]) {
  const items = products.map((p) =>
    `<li><a href="${esc(productPath(p))}">${esc(p.name)}<span>${price(p.price)} Kč${stockCount(p) === 0 ? " · vyprodáno" : ""}</span></a></li>`).join("");
  const body = `${STATIC_CSS}<main class="seo-static"><h1>HOPI VIRTUAL – oficiální merch</h1><p>${esc(DESC)}</p>${items ? `<h2>Produkty</h2><ul>${items}</ul>` : ""}<p><a href="/spoluprace/ridic">Nábor řidičů</a> · <a href="/spoluprace/firma">Spolupráce s firmami</a></p></main>`;
  const list = products.length ? [{ "@context": "https://schema.org", "@type": "ItemList", itemListElement: products.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: SITE + productPath(p), name: String(p.name ?? "") })) }] : [];
  return inject(html, headTags({ title: "HOPI VIRTUAL – oficiální merch e-shop", desc: DESC, url: SITE + "/", img: SITE + "/logo-hero.png", type: "website", ld: [SITE_LD, ...list] }), body);
}

export function productPage(html: string, p: Product, reviews: Review[] = []) {
  const url = SITE + productPath(p), stock = stockCount(p), ims = images(p);
  const desc = clip(p.description ? p.description : `${p.name} – oficiální merch HOPI VIRTUAL za ${price(p.price)} Kč. ${stock === 0 ? "Momentálně vyprodáno." : "Skladem, doručení po celé ČR a SR."}`, 158);
  const title = `${p.name} | HOPI VIRTUAL merch`;
  const ld = {
    "@context": "https://schema.org", "@type": "Product", name: String(p.name ?? ""), description: desc, sku: String(p.id), url,
    brand: { "@type": "Brand", name: "HOPI VIRTUAL" }, ...(ims.length ? { image: ims } : {}),
    ...(p.categoryLabel || p.category ? { category: String(p.categoryLabel || p.category) } : {}),
    offers: { "@type": "Offer", url, priceCurrency: "CZK", price: Number(p.price) || 0, itemCondition: "https://schema.org/NewCondition",
      availability: stock === 0 ? "https://schema.org/OutOfStock" : "https://schema.org/InStock", seller: { "@type": "Organization", name: "HOPI VIRTUAL" } },
    ...reviewLd(reviews),
  };
  const rvHtml = reviews.length ? `<section><h2>Hodnocení zákazníků</h2>${reviews.slice(0, 10).map((r) => `<p>${"★".repeat(Number(r.rating))} ${esc(r.name || "Zákazník")}${r.comment ? ": " + esc(r.comment) : ""}</p>`).join("")}</section>` : "";
  const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "HOPI VIRTUAL", item: SITE + "/" },
    { "@type": "ListItem", position: 2, name: String(p.name ?? ""), item: url }] };
  const body = `${STATIC_CSS}<main class="seo-static"><p><a href="/">HOPI VIRTUAL</a> / ${esc(p.categoryLabel || p.category || "Merch")}</p><h1>${esc(p.name)}</h1>${ims[0] ? `<img src="${esc(ims[0])}" alt="${esc(p.name)}" width="520" height="520">` : ""}<p><strong>${price(p.price)} Kč</strong> · včetně DPH · ${stock === 0 ? "vyprodáno" : "skladem"}${p.sizes ? " · velikosti " + esc(p.sizes) : ""}</p><p>${esc(p.description || desc)}</p>${rvHtml}</main>`;
  return inject(html, headTags({ title, desc, url, img: ims[0] || SITE + "/logo-hero.png", type: "product", ld: [SITE_LD, ld, crumbs] }), body);
}

export function sitemapXml(products: Product[]) {
  const u = (loc: string, extra = "") => `<url><loc>${esc(loc)}</loc>${extra}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    [u(SITE + "/"), u(SITE + "/spoluprace/ridic"), u(SITE + "/spoluprace/firma"),
      ...products.map((p) => u(SITE + productPath(p), images(p).slice(0, 5).map((i) => `<image:image><image:loc>${esc(i)}</image:loc></image:image>`).join("")))].join("\n") +
    "\n</urlset>\n";
}

const isHtml = (r: Response) => (r.headers.get("content-type") || "").includes("text/html");
const withHtml = (r: Response, html: string, status = r.status) => {
  const h = new Headers(r.headers);
  h.delete("content-length"); h.delete("etag");
  h.set("content-type", "text/html; charset=utf-8");
  h.set("cache-control", "public, max-age=0, must-revalidate");
  return new Response(html, { status, headers: h });
};

export default async function handler(req: Request, context: Ctx): Promise<Response | undefined> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/sitemap.xml") {
    try {
      const products = await db("products?select=*&order=id.asc");
      return new Response(sitemapXml(Array.isArray(products) ? products : []), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
    } catch { return new Response(sitemapXml([]), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } }); }
  }

  const m = path.match(/^\/produkt\/(\d+)(?:-([^\/]*))?\/?$/);
  if (path !== "/" && !m) return undefined; // nic nedělat

  // produkt: nejdřív data (kvůli 301/404), pak stránka
  let product: Product | null = null, products: Product[] = [], dbOk = true;
  try {
    if (m) { const r = await db(`products?select=*&id=eq.${Number(m[1])}`); product = Array.isArray(r) && r[0] ? r[0] : null; }
    else { const r = await db("products?select=*&order=id.asc"); products = Array.isArray(r) ? r : []; }
  } catch { dbOk = false; }

  if (m && product) {
    const want = productPath(product);
    if (decodeURIComponent(path).replace(/\/$/, "") !== want) {
      return new Response(null, { status: 301, headers: { location: want + url.search, "cache-control": "public, max-age=300" } });
    }
  }

  const res = await context.next();
  if (!dbOk || !isHtml(res)) return res;
  let html: string;
  try { html = await res.text(); } catch { return res; }
  if (!html.includes("<!--seo-->")) return withHtml(res, html);
  try {
    if (!m) return withHtml(res, homePage(html, products));
    if (product) return withHtml(res, productPage(html, product, reviewsFor(await publicReviews(), Number(product.id))));
    // neexistující produkt → 404, ať se v Googlu neobjeví prázdná stránka
    const head = headTags({ title: "Produkt nenalezen | HOPI VIRTUAL", desc: DESC, url: SITE + path, img: SITE + "/logo-hero.png", type: "website", robots: "noindex", ld: [SITE_LD] });
    return withHtml(res, inject(html, head, ""), 404);
  } catch {
    return withHtml(res, html);
  }
}

export const config = { path: ["/", "/produkt/*", "/sitemap.xml"] };
