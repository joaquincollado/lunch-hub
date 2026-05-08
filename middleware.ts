import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROXY_TARGETS: Record<string, string> = {
  healthyclub: "https://pedidos.thehealthyclub.uy",
  tuviandita: "https://tuviandita.enviandate.com",
  estosi: "https://estosi.enviandate.com",
};

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const match = pathname.match(/^\/proxy\/([^/]+)(\/.*)?$/);
  if (!match) return NextResponse.next();

  const slug = match[1];
  const upstream = PROXY_TARGETS[slug];
  if (!upstream) return NextResponse.next();

  const path = match[2] || "/";
  const targetUrl = `${upstream}${path}${search}`;
  const proxyPrefix = `/proxy/${slug}`;

  // Forward request headers, but strip ones that confuse the upstream.
  // GeneXus 302s to /sitionoencontrado when x-forwarded-host is localhost-y.
  const forwardHeaders = new Headers();
  const skipHeaders = new Set([
    "host",
    "connection",
    "keep-alive",
    "x-forwarded-host",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-forwarded-port",
    "x-real-ip",
  ]);
  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();
    if (skipHeaders.has(lower)) continue;
    if (lower.startsWith("x-middleware")) continue;
    if (lower.startsWith("x-invoke")) continue;
    forwardHeaders.set(key, value);
  }
  forwardHeaders.set("origin", upstream);
  forwardHeaders.set("referer", `${upstream}/`);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const upstreamRes = await fetch(targetUrl, {
    method: request.method,
    headers: forwardHeaders,
    body,
    redirect: "manual",
  });

  const contentType = upstreamRes.headers.get("content-type") || "";
  const headers = new Headers();

  for (const [key, value] of upstreamRes.headers.entries()) {
    const lower = key.toLowerCase();
    if (lower === "x-frame-options") continue;
    if (lower === "content-security-policy") continue;
    if (lower === "content-encoding") continue;
    if (lower === "transfer-encoding") continue;
    if (lower === "set-cookie") continue;
    if (lower === "location") continue;
    headers.set(key, value);
  }

  // Scope each provider's cookies to its proxy path so sessions don't collide.
  const setCookies = upstreamRes.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    headers.append("set-cookie", rewriteCookie(cookie, proxyPrefix));
  }

  // Rewrite redirect Location so post-form 302s land back inside the proxy.
  const location = upstreamRes.headers.get("location");
  if (location) {
    headers.set("location", rewriteUrl(location, upstream, proxyPrefix));
  }

  if (upstreamRes.status >= 300 && upstreamRes.status < 400) {
    return new NextResponse(null, { status: upstreamRes.status, headers });
  }

  if (contentType.includes("text/html")) {
    const html = rewriteHtml(await upstreamRes.text(), upstream, proxyPrefix);
    return new NextResponse(html, { status: upstreamRes.status, headers });
  }

  if (contentType.includes("text/css")) {
    const css = rewriteCss(await upstreamRes.text(), upstream, proxyPrefix);
    return new NextResponse(css, { status: upstreamRes.status, headers });
  }

  if (contentType.includes("javascript") || contentType.includes("application/json")) {
    const text = rewriteJsLike(await upstreamRes.text(), upstream, proxyPrefix);
    return new NextResponse(text, { status: upstreamRes.status, headers });
  }

  return new NextResponse(upstreamRes.body, {
    status: upstreamRes.status,
    headers,
  });
}

function rewriteUrl(url: string, upstream: string, proxyPrefix: string): string {
  if (url.startsWith(upstream)) {
    return proxyPrefix + (url.slice(upstream.length) || "/");
  }
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith(proxyPrefix + "/") && url !== proxyPrefix) {
    return proxyPrefix + url;
  }
  return url;
}

function rewriteCookie(cookie: string, proxyPrefix: string): string {
  // Strip Domain and rewrite Path so the cookie is scoped to /proxy/<slug>.
  // No trailing slash so the cookie matches both `/proxy/<slug>` (e.g. an
  // AJAX POST with just a query string) and `/proxy/<slug>/...` per
  // RFC 6265 path-matching rules.
  let out = cookie.replace(/;\s*[Dd]omain=[^;]*/g, "");
  if (/;\s*[Pp]ath=/.test(out)) {
    out = out.replace(/;\s*[Pp]ath=([^;]*)/, (_, p: string) => {
      const trimmed = p.trim();
      const newPath = trimmed === "/" ? proxyPrefix : proxyPrefix + trimmed;
      return `; Path=${newPath}`;
    });
  } else {
    out += `; Path=${proxyPrefix}`;
  }
  return out;
}

function rewriteHtml(html: string, upstream: string, proxyPrefix: string): string {
  // Rewrite absolute paths in URL-bearing attributes
  html = html.replace(
    /(\b(?:href|src|action|formaction|poster|data-src|data-href|data-url)\s*=\s*["'])(\/(?!\/|proxy\/))/gi,
    `$1${proxyPrefix}/`
  );

  // Rewrite full upstream URLs (e.g. <link rel="canonical" href="https://upstream/...">)
  const escapedUpstream = upstream.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  html = html.replace(new RegExp(escapedUpstream, "g"), proxyPrefix);

  // Rewrite url(/...) inside inline <style> blocks and style="" attributes
  html = html.replace(/url\(\s*(['"]?)\/(?!\/|proxy\/)/g, `url($1${proxyPrefix}/`);

  // GeneXus embeds a JSON state blob (the GXState hidden input) with paths
  // like "Imagensrc":"/static/Resources/Flecha.gif". The attribute regex above
  // only catches `attr="/path"`, not JSON values, so apply prefix rewriting to
  // known absolute path prefixes anywhere they appear as quoted strings.
  html = html.replace(
    /(['"`])\/(static|PublicTempStorage|PrivateTempStorage|Resources)\//g,
    `$1${proxyPrefix}/$2/`
  );

  // Inject a runtime shim that rewrites URLs used by JS APIs.
  const shim = buildShim(upstream, proxyPrefix);
  if (/<head([^>]*)>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>${shim}`);
  } else {
    html = shim + html;
  }

  return html;
}

function rewriteCss(css: string, upstream: string, proxyPrefix: string): string {
  const escapedUpstream = upstream.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  css = css.replace(new RegExp(escapedUpstream, "g"), proxyPrefix);
  css = css.replace(/url\(\s*(['"]?)\/(?!\/|proxy\/)/g, `url($1${proxyPrefix}/`);
  return css;
}

function rewriteJsLike(text: string, upstream: string, proxyPrefix: string): string {
  const escapedUpstream = upstream.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  text = text.replace(new RegExp(escapedUpstream, "g"), proxyPrefix);

  // GeneXus JS frequently builds URLs by string-concatenating "/static/foo"
  // or "/PublicTempStorage/foo" and then assigns them to img.src or innerHTML,
  // which the runtime fetch/XHR shim can't intercept. Rewrite known absolute
  // path prefixes when they appear inside string literals.
  text = text.replace(
    /(['"`])\/(static|PublicTempStorage|PrivateTempStorage|Resources)\//g,
    `$1${proxyPrefix}/$2/`
  );

  return text;
}

function buildShim(upstream: string, proxyPrefix: string): string {
  return `<script>(function(){
  var prefix = ${JSON.stringify(proxyPrefix)};
  var upstream = ${JSON.stringify(upstream)};
  var URL_ATTRS = { src:1, href:1, action:1, formaction:1, poster:1, 'xlink:href':1, data:1, srcdoc:0 };

  function rewrite(url) {
    if (url == null) return url;
    var s = String(url);
    if (s.indexOf(upstream) === 0) {
      var rest = s.slice(upstream.length);
      return prefix + (rest || '/');
    }
    if (s.charAt(0) === '/' && s.charAt(1) !== '/' && s.indexOf(prefix + '/') !== 0 && s !== prefix) {
      return prefix + s;
    }
    return url;
  }

  // Rewrite URL-bearing attributes inside an HTML string. Same regex as the
  // server-side rewriter in middleware.ts.
  function rewriteHtmlString(html) {
    if (typeof html !== 'string' || html.length === 0) return html;
    var attrRe = /(\\b(?:href|src|action|formaction|poster|data-src|data-href|data-url)\\s*=\\s*["'])(\\/(?!\\/|proxy\\/))/gi;
    html = html.replace(attrRe, '$1' + prefix + '/');
    var upRe = new RegExp(upstream.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), 'g');
    html = html.replace(upRe, prefix);
    return html;
  }

  window.__proxyRewrite = rewrite;
  window.__proxyRewriteHtml = rewriteHtmlString;

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function(input, init) {
      try {
        if (typeof input === 'string') {
          input = rewrite(input);
        } else if (input && typeof input.url === 'string') {
          var newUrl = rewrite(input.url);
          if (newUrl !== input.url) input = new Request(newUrl, input);
        }
      } catch (e) {}
      return origFetch.call(this, input, init);
    };
  }

  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    arguments[1] = rewrite(url);
    return origOpen.apply(this, arguments);
  };

  if (window.history) {
    var origPush = history.pushState;
    history.pushState = function(state, title, url) {
      if (url != null) arguments[2] = rewrite(url);
      return origPush.apply(this, arguments);
    };
    var origReplace = history.replaceState;
    history.replaceState = function(state, title, url) {
      if (url != null) arguments[2] = rewrite(url);
      return origReplace.apply(this, arguments);
    };
  }

  var origWinOpen = window.open;
  window.open = function(url) {
    if (url != null) arguments[0] = rewrite(url);
    return origWinOpen.apply(this, arguments);
  };

  // Patch setAttribute so URL attributes set programmatically (jQuery's
  // $("<iframe/>", {src: k}) goes through this) get rewritten.
  var origSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (name && URL_ATTRS[String(name).toLowerCase()] && typeof value === 'string') {
      value = rewrite(value);
    }
    return origSetAttr.call(this, name, value);
  };

  // Patch innerHTML / outerHTML setters so iframe/img/script tags injected via
  // HTML strings (e.g. GeneXus popup builds '<iframe src="/foo">' and assigns)
  // have their URL attributes rewritten before the browser parses the string.
  function patchHtmlSetter(proto, prop) {
    var desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || !desc.set) return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function(value) { return desc.set.call(this, rewriteHtmlString(value)); }
    });
  }
  patchHtmlSetter(Element.prototype, 'innerHTML');
  patchHtmlSetter(Element.prototype, 'outerHTML');
  if (typeof ShadowRoot !== 'undefined') patchHtmlSetter(ShadowRoot.prototype, 'innerHTML');
  if (typeof DocumentFragment !== 'undefined') patchHtmlSetter(DocumentFragment.prototype, 'innerHTML');

  // Patch direct property assignment on URL-bearing elements: img.src = '/foo'.
  function patchUrlProp(proto, prop) {
    var desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || !desc.set) return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function(value) {
        if (typeof value === 'string') value = rewrite(value);
        return desc.set.call(this, value);
      }
    });
  }
  patchUrlProp(HTMLImageElement.prototype, 'src');
  patchUrlProp(HTMLIFrameElement.prototype, 'src');
  patchUrlProp(HTMLScriptElement.prototype, 'src');
  patchUrlProp(HTMLLinkElement.prototype, 'href');
  patchUrlProp(HTMLAnchorElement.prototype, 'href');
  patchUrlProp(HTMLFormElement.prototype, 'action');

  // Intercept programmatic navigation via location.assign / replace.
  try {
    var loc = window.location;
    var origAssign = loc.assign && loc.assign.bind(loc);
    if (origAssign) loc.assign = function(url) { return origAssign(rewrite(url)); };
    var origLocReplace = loc.replace && loc.replace.bind(loc);
    if (origLocReplace) loc.replace = function(url) { return origLocReplace(rewrite(url)); };
  } catch (e) {}
})();</script>`;
}

export const config = {
  matcher: "/proxy/:path*",
};
