# Maison Clair

A premium optical boutique website. React + TypeScript + Vite + Tailwind CSS.

## Navigation

The navbar has exactly three destinations, each an anchor on the single page:

- **Frames** (`#frames`) — the catalog: category → brand → frames.
- **Accessories** (`#accessories`) — a flat grid of accessories.
- **About Store** (`#about-store`) — editorial copy about the boutique.

## Browsing flow

The Frames section is built around one flow: **category → brand → frames**.

1. The visitor picks a category (`CategorySelector`).
2. The visitor picks a brand (`BrandSelector`) — every brand is carried in every category, so the
   brand list never depends on which category is selected.
3. Once both are picked, the frame grid (`FrameGrid`) shows the matching frames.

Frame and accessory cards are display-only by design — no click handler, no detail page, no cart.
Clicking a category or brand tile is the only interactive gesture in the collection flow.

## Language

The site is bilingual (French / English), **French by default**. The visitor's choice persists in
`localStorage` (`maison-clair-locale`) and is restored on their next visit; a first-time visit with
nothing stored always starts in French.

- `i18n/locale.ts` — the `Locale` type and the `localStorage` read/write (wrapped in try/catch —
  private browsing or blocked storage just means the choice doesn't persist, nothing breaks).
- `i18n/LocaleContext.tsx` / `i18n/useLocale.ts` — holds the current locale and sets `<html lang>`.
- `i18n/translations/{en,fr}.ts` — all UI copy (nav, hero, section headings, status/loading/error/empty
  messages, footer). `useTranslations()` returns the active dictionary.
- `i18n/categoryLabels.ts`, `colorLabels.ts`, `accessoryLabels.ts` — translate *display* text for
  data that's still matched/filtered by its canonical English value (a category name, a frame's
  color, an accessory's id). Selection logic always runs on the canonical value; only what's shown
  on screen is translated. An entry missing from these maps falls back to the canonical English
  text rather than breaking, so new categories/colors/accessories render immediately and can be
  translated later.

**Deliberately not translated**: brand names and frame model names (e.g. "Ray-Ban", "Clubmaster
Optics") — treated as proper nouns/product names, the way real eyewear retailers keep them in
every market. Prices stay in USD but use locale-appropriate `Intl.NumberFormat` styling
(`formatPrice(price, currency, locale)`).

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
npm run lint      # oxlint
```

This talks to the [backend](../backend) — start that too (`cd ../backend && npm install && npm
start`, see its README) or every fetch will fail. `.env.development` sets `VITE_API_ORIGIN=
http://localhost:4000` for `npm run dev` specifically, since the two run as separate dev servers;
a production build has no such file and defaults to same-origin, matching how
`backend/resources/README.md` expects the build to be deployed (served by the backend itself).

## Architecture

```
src/
├── config/       apiOrigin — the base URL the backend's relative asset paths resolve against.
├── types/        CatalogTaxonomy, Brand, Category, Frame, Accessory — the shapes the API returns.
├── data/         siteConfig (static site copy, see Content & configuration below)
│                 + categoryPresentation (the frontend-only fallback image for a category photo).
├── services/     CatalogService / FrameService / AccessoryService / SiteInfoService interfaces,
│                 each with one `fetch`-based implementation (the seam the [backend](../backend) plugs into).
├── hooks/        useCatalog / useFrames / useAccessories — call the services, own loading/error/caching,
│                 and resolve every url/imageUrl/images[] the backend returns to a full URL.
├── components/   Presentational components, grouped by domain (categories, brands, frames, accessories, layout, home).
├── pages/        HomePage — owns selection state and wires hooks to components.
└── utils/        formatPrice, resolveAssetUrl (backend path -> full URL) and other pure helpers.
```

Data flows one direction: **services → hooks → components**. Components never call a service or
touch `fetch` directly — they receive everything through props, and hooks are the only thing that
talk to a service. Category and brand names are never hardcoded inside a component; they always
arrive through `useCatalog()`.

## The catalog taxonomy

`CatalogTaxonomy` is `{ categories: Category[]; brands: Brand[] }`, both fetched together in one
call (`CatalogService.getCategoriesAndBrands()`). **Every brand is available in every category** —
the UI never filters the brand list by the selected category, and switching categories never
resets the chosen brand.

`Category` is `{ id: number; name: string; url: string }`; `Brand` is `{ id: string; name: string }` (a UUID).
Nothing in the app keys off either id yet — selection, `CategoryCard`/`BrandOption`'s `isSelected`
checks, and `Frame` matching (`frame.category`, `frame.brand`) all still run on `name`. Both ids
are only used as React list keys today.

`Category.url` points to the category's photo. If it's missing, or the image 404s or fails to
load, `CategoryCard` falls back to `data/categoryPresentation.ts`'s single generic image, so a bad
photo never breaks the tile.

**Backend response shape** for `GET /api/catalog`:

```json
{
  "categories": [
    { "id": 1, "name": "Optical Frames", "url": "/categories/optical-frames.jpg" },
    { "id": 2, "name": "Sunglasses", "url": "/categories/sunglasses.jpg" },
    { "id": 3, "name": "Kids", "url": "/categories/kids.jpg" }
  ],
  "brands": [
    { "id": 1, "name": "Ray-Ban" },
    { "id": 2, "name": "Oakley" },
    { "id": 3, "name": "Gucci" },
    { "id": 4, "name": "Prada" }
  ]
}
```

**Frame and accessory photos arrive as ids.** Every frame and accessory the backend sends carries
`imageIds`: the ids of the photos the shop uploaded for it. The site fetches each photo with
`GET <API origin>/api/images/<id>` (`utils/imageUrl.ts`: `buildPhotoUrl`, `buildProductImageUrls`;
`utils/resolveImageUrl.ts`: `resolveProductImages`). The card always shows the first one; the detail
view's gallery shows all of them, in the order the backend sent. Every data-fetching hook turns the
ids into addresses before anything renders them, so a component reads `images` as ready-to-use
addresses. An item without ids (an older record) still shows its older `images` codes, resolved as
`<API origin>/images/<host name>/<code>` (the host name is the one the site is served from,
`window.location.hostname`; the backend turns it into the shop, so no private key appears in an
address). An already-absolute URL (`https://…`, `//cdn…`) is left untouched, and so is a path starting
with `/`, which resolves against the origin as before. `API_ORIGIN` is `config/apiOrigin.ts` (set via
the `VITE_API_ORIGIN` env var; empty/same-origin by default).

**Other images the backend owns** (`Category.url`) are still sent as paths (or absolute URLs, e.g.
the hotlinked Unsplash photos) and resolved against `API_ORIGIN` through
`utils/resolveAssetUrl.ts`.

## Frames

`GET /api/frames?brand=&categorie=` (note: `categorie`, the backend's own spelling, not
`category`) returns the frame list for one category+brand combination — `frameService.ts` is the
seam, same pattern as `catalogService.ts`. Each `Frame` carries `images: string[]`, not a single
`imageUrl`: the grid/card view always renders `images[0]`, leaving room for a future detail view
to use the rest. `hooks/useFrames.ts` caches by `${category}:${brand}` in memory, so re-selecting a
combination already fetched this session never calls the service again.

## Accessories and site info are fetched on approach, not on page load

Two sections load their data lazily, only once the visitor scrolls near them, instead of fetching
the moment the page mounts:

- **Accessories** (`AccessoriesSection.tsx`) — `accessoryService.ts` stands in for `GET
  /api/accessories`.
- **Footer contact details and social links** (`Footer.tsx`) — `siteInfoService.ts` stands in for
  `GET /api/infos`, returning `{ social: { label, url }[], contact: { address, phone, email } }`.
  This replaced the social/contact fields `siteConfig.ts` used to hold statically — they're fetched
  content now, not site config, the same reasoning that moved categories and brands out of static
  data earlier.

Both follow the same pattern: the section attaches `hooks/useInView.ts`'s `ref` to its root element
with a `rootMargin: '400px'` (so the fetch starts ~400px before the section is actually on-screen,
not only once it's visible), and passes the resulting `isInView` boolean into `useAccessories()` /
`useSiteInfo()` as a `shouldFetch` flag. Each hook only calls its service the first time
`shouldFetch` turns true (a ref latch prevents refetching if the section re-enters view later).

## Content & configuration

- `data/siteConfig.ts` holds the copy that isn't fetched and isn't a category/brand/frame/accessory:
  store name, announcement bar, hero copy, nav links, footer label, benefits. Contact details and
  social links live in `GET /api/infos` instead (see above) — editing `siteConfig.ts` reskins the
  rest without touching components.
- `public/images/` holds this frontend's own illustrations: the hero and about-store art, and the
  fallback image `CategoryCard` falls back to if a category's backend-provided `url` is missing or
  broken. Category, frame, and accessory photography all come from the backend as plain
  `url`/`images[]`/`imageUrl` strings — those live in `backend/public/images/` and
  `backend/src/data/`, not here.
