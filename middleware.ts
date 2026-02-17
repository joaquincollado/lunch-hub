import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // For proxied healthyclub requests, fetch directly and strip X-Frame-Options
  if (request.nextUrl.pathname.startsWith("/proxy/healthyclub")) {
    const path = request.nextUrl.pathname.replace("/proxy/healthyclub", "") || "/";
    const targetUrl = `https://pedidos.thehealthyclub.uy${path}${request.nextUrl.search}`;

    return fetch(targetUrl, {
      method: request.method,
      headers: {
        "User-Agent": request.headers.get("user-agent") || "Mozilla/5.0",
        "Accept": request.headers.get("accept") || "*/*",
        "Accept-Language": request.headers.get("accept-language") || "es",
      },
    }).then(async (upstreamRes) => {
      const contentType = upstreamRes.headers.get("content-type") || "";
      const headers = new Headers();

      for (const [key, value] of upstreamRes.headers.entries()) {
        const lower = key.toLowerCase();
        if (lower === "x-frame-options") continue;
        if (lower === "content-security-policy") continue;
        if (lower === "content-encoding") continue;
        if (lower === "transfer-encoding") continue;
        headers.set(key, value);
      }

      if (contentType.includes("text/html")) {
        let html = await upstreamRes.text();
        // Inject <base> so relative URLs (/static/...) resolve to the original site
        html = html.replace(
          /<head([^>]*)>/i,
          `<head$1><base href="https://pedidos.thehealthyclub.uy/">`
        );
        return new NextResponse(html, { status: upstreamRes.status, headers });
      }

      return new NextResponse(upstreamRes.body, {
        status: upstreamRes.status,
        headers,
      });
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/proxy/healthyclub/:path*",
};
