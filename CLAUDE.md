# Lunch Hub

A single-page Next.js app that aggregates multiple Uruguayan lunch-ordering sites into one tabbed view. Each tab renders a provider's site inside an iframe so the user can browse menus side-by-side. Login and checkout happen on the real upstream site (opened in a new tab) — see "The iframe wall" below.

## Stack

- Next.js 16 (App Router), React 19, TypeScript
- Tailwind v4
- `next dev` to run locally on `http://localhost:3000`

## Layout

- `app/page.tsx` — top-level page. Holds active-tab state and renders `<ProviderTabs>` + `<IframePanel>`.
- `components/ProviderTabs.tsx` — desktop tab strip / mobile dropdown.
- `components/IframePanel.tsx` — keeps every provider's iframe mounted, hides inactive ones with `invisible` so sessions/scroll position survive tab switches.
- `config/providers.json` — list of providers (id, name, proxy url, color). All `url`s point at `/proxy/<slug>`, never the upstream domain directly (see "Why a proxy" below).
- `middleware.ts` — the reverse proxy. Anything matching `/proxy/:path*` is forwarded to the corresponding upstream in `PROXY_TARGETS`.

## Why a proxy

All three providers run the same GeneXus stack and respond with `X-Frame-Options: SAMEORIGIN`, which blocks them from being iframed cross-origin. The middleware fetches the upstream server-side, strips `X-Frame-Options` / `Content-Security-Policy` from the response, and serves the result from `localhost:3000` so the browser is happy to embed it.

To make the embedded page actually *work* (not just render), the proxy is "transparent": every URL the page might use is rewritten to stay under `/proxy/<slug>/` so requests, cookies, and form posts all stay same-origin.

## Proxy gotchas (hard-won)

These are the things that broke and how they were fixed — don't undo any of them without a plan.

1. **Don't forward `x-forwarded-host`.** Next.js dev injects `x-forwarded-host: localhost:3000` into incoming requests. GeneXus inspects that header and 302s to `/sitionoencontrado` ("Site not found") when the value isn't its own hostname. The middleware explicitly strips `x-forwarded-*`, `x-real-ip`, `x-middleware-*`, and `x-invoke-*` from the forwarded request. It also forces `Origin` and `Referer` to the upstream.

2. **Rewrite every absolute path in HTML, not just `<base href>`.** A `<base href="https://upstream/">` only retargets *relative* URLs. Absolute paths like `/static/foo.js` are unaffected and resolve to `localhost:3000/static/foo.js`, which 404s. The middleware does regex-based rewriting of `href`, `src`, `action`, `formaction`, `poster`, `data-src`, `data-href`, `data-url` plus full upstream URLs and `url(...)` in inline styles.

3. **Rewrite CSS files too.** `url(/static/img.png)` inside a CSS file resolves against the CSS file's URL, which after proxying is `localhost:3000`. Without rewrite the asset 404s.

4. **Inject a runtime JS shim.** Static rewriting can't catch URLs constructed at runtime by JavaScript. The shim (`buildShim` in middleware.ts) patches `fetch`, `XMLHttpRequest.prototype.open`, `history.pushState`, `history.replaceState`, `window.open`, `location.assign`, and `location.replace` to prepend `/proxy/<slug>` to any same-origin absolute path. Exposed as `window.__proxyRewrite` for debugging.

5. **Scope `Set-Cookie` paths.** All three providers set `JSESSIONID`, `GX_SESSION_ID`, etc. with `Path=/`. Without rewriting, the three providers' sessions collide on `localhost:3000`. The middleware rewrites `Path=/` → `Path=/proxy/<slug>/` and strips any `Domain=` attribute.

6. **Rewrite `Location` headers and use `redirect: "manual"`.** Form POSTs commonly 302 to a GET URL (PRG pattern). Letting fetch follow the redirect server-side hides the redirect from the browser, which means the iframe URL never updates and refresh re-POSTs. Instead the middleware uses `redirect: "manual"`, rewrites the `Location` header to the proxy path, and passes the 3xx through to the browser.

7. **Buffer request bodies.** Streaming `request.body` to `fetch` in the Edge runtime is fragile (`duplex: "half"` requirement, etc.). The middleware reads the body to an `ArrayBuffer` first. Form POSTs are small, so this is fine.

8. **Three sites = three slugs.** The `PROXY_TARGETS` map is keyed by slug. Adding a provider means: add entry to `PROXY_TARGETS`, add entry to `config/providers.json` with `url: "/proxy/<slug>/"`. The matcher `/proxy/:path*` already covers it.

9. **Iframe URL must end in `/`, and Next.js's trailing-slash redirect must be off.** Page JS does `element.innerHTML = '<img src="static/foo">'` (relative path). Browser resolves the relative path against the document URL: with `/proxy/<slug>` (no slash) it becomes `/proxy/static/foo` (404), with `/proxy/<slug>/` it becomes `/proxy/<slug>/static/foo` (✓). So `config/providers.json` URLs end in `/`, and `next.config.ts` sets `skipTrailingSlashRedirect: true` to stop Next.js from 308-ing the slash away before middleware runs.

10. **Cookie `Path` must NOT end in `/`.** Per RFC 6265 path matching, a cookie with `Path=/proxy/<slug>/` does NOT match a request to `/proxy/<slug>?foo` (no trailing slash) — and GeneXus AJAX calls do exactly that, hitting the bare slug path with just a query string. The result is a 401 on every AJAX call. Cookie path is therefore set to `/proxy/<slug>` with no trailing slash, which RFC 6265 considers a match for both `/proxy/<slug>` and `/proxy/<slug>/...`.

11. **Rewrite known absolute path prefixes inside HTML/JS string values too.** GeneXus embeds a `<input name="GXState">` with a JSON blob containing things like `"Imagensrc":"/static/Resources/Flecha.gif"`. The attribute-rewrite regex (`href="..."`) doesn't catch JSON values. The middleware also runs `(['"`])/(static|PublicTempStorage|PrivateTempStorage|Resources)/` → `$1<prefix>/$2/` over HTML and JS bodies as a backstop. If you discover a new path prefix that gets used dynamically, add it to that list.

## The iframe wall (why "Order on …" opens a new tab)

Even with a perfect transparent proxy, third-party widgets embedded by the providers refuse to run when the page hostname is `localhost`:

- **reCAPTCHA** validates `window.location.hostname` against an allowlist configured in *Google's* admin console for the upstream's site key. The allowlist contains `tuviandita.enviandate.com` etc., not `localhost`. The check is client-side and we can't lie about the hostname (Google's frame talks to its own domain). The visible error is "El host local no está en la lista de dominios admitidos".
- The same will hit any payment provider iframe (Mercado Pago, etc.), 3DS card-verification flows, OAuth login buttons.

There is no fix without the upstream adding our hostname to their reCAPTCHA/etc. allowlist, which won't happen.

So the design is **hybrid**: the iframe is for browsing menus, and an "Order on {provider}" button (top-right of the iframe area in `IframePanel.tsx`) opens the real upstream site in a new tab when the user actually wants to authenticate / pay. `config/providers.json` carries both `url` (the proxy path) and `directUrl` (the real upstream URL) for each provider.

Cart state does NOT transfer between the iframe and the new-tab session — different cookie jars (proxy localhost vs real upstream domain). Treat the iframe as a menu viewer, not a stateful ordering surface.

## Known limits

- Hard-coded full upstream URLs in JS source (e.g. `fetch("https://pedidos.thehealthyclub.uy/api/foo")`) are rewritten by `rewriteJsLike` for the upstream we know about, but cross-provider hard-coded URLs would not be.
- `location.href = "/foo"` setter is *not* monkey-patched (Location.prototype is hostile to override). If a provider's JS does this, navigation will escape the proxy. We patch `assign`/`replace` instead, which covers the common cases.
- WebSocket URLs (the GeneXus apps reference `GX_WEBSOCKET_ID`) are not proxied. If real-time features are needed, a separate WS proxy is required.
- Anything authenticated past the login page is untested — login flow may need additional work.

## Conventions

- Keep the providers list and `PROXY_TARGETS` in sync (slug must match).
- Don't reintroduce `<base href>` injection — it conflicts with the absolute-path rewriting strategy.
- The middleware is the only place the upstream domains appear. Don't put upstream URLs in `providers.json` or anywhere else in the app.
