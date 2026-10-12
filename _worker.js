const QUICK_SCAN_ORIGIN = "https://preview.neurobusiness.one";

async function serveQuickScan(request) {
  const requestUrl = new URL(request.url);
  const locale = requestUrl.searchParams.get("lang") === "en" ? "en" : "de";
  const upstreamUrl = new URL("/quiz", QUICK_SCAN_ORIGIN);
  upstreamUrl.search = requestUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const upstreamResponse = await fetch(new Request(upstreamUrl, init));
  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");

  const response = new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });

  if (!responseHeaders.get("content-type")?.includes("text/html")) {
    return response;
  }

  const languageSwitch = `<div class="nav-language" aria-label="${locale === "en" ? "Language" : "Sprache"}"><a href="/quiz?lang=de" lang="de"${locale === "de" ? ' aria-current="page"' : ""}>DE</a><span aria-hidden="true">/</span><a href="/quiz?lang=en" lang="en"${locale === "en" ? ' aria-current="page"' : ""}>EN</a></div>`;
  const languageCss = `<style>
    .site-nav .nav-language{display:flex;align-items:center;gap:8px;padding-left:20px;border-left:1px solid rgba(21,19,15,.12);font-size:12px;letter-spacing:1px;white-space:nowrap}
    .site-nav .nav-language a{color:inherit;text-decoration:none;opacity:.4}
    .site-nav .nav-language a[aria-current="page"]{opacity:1;font-weight:700}
    .site-nav .nav-language span{opacity:.25}
  </style>`;

  return new HTMLRewriter()
    .on("head", {
      element(element) {
        element.append(languageCss, { html: true });
      },
    })
    .on('main > .actions[aria-label="Language"]', {
      element(element) {
        element.remove();
      },
    })
    .on('main > .actions[aria-label="Sprache"]', {
      element(element) {
        element.remove();
      },
    })
    .on("nav.site-nav a.button", {
      element(element) {
        element.before(languageSwitch, { html: true });
      },
    })
    .transform(response);
}

// Keep API/assessment behavior separate from public discovery routing.
const aliases = {
  "/Solo.dc": "/solo", "/Solo.dc.html": "/solo",
  "/Team.dc": "/teams", "/Team.dc.html": "/teams",
  "/Coach.dc": "/coaches", "/Coach.dc.html": "/coaches",
  "/ai-adoption-consulting": "/ai-adoption",
  "/ai-transformation": "/human-ai-transformation",
  "/Homepage.dc.html": "/", "/Homepage.dc": "/",
};
const marketingAssets = { "/solo": "/Solo.dc.html", "/teams": "/Team.dc.html", "/coaches": "/Coach.dc.html" };
const privatePage = /^\/(?:admin(?:-login)?|app|coach-login|practitioner|team-dashboard|diagnostic|result_v2(?:_en)?|success|checkout-success|cancel|reports|dashboard|login)(?:\.html|\/|$)/;
const internalFile = /^\/(?:_db|_docs|_site-source|scripts|workers|content|\.git|\.github)(?:\/|$)|\.(?:md|sql|toml|csv|docx)$|\/\.DS_Store$/i;
function withPrivateHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return new Response("Bad request", {status: 400}); }
    if (internalFile.test(pathname)) return new Response("Not found", {status:404, headers:{"X-Robots-Tag":"noindex", "Cache-Control":"no-store"}});
    // Never normalize transaction URLs or change their query strings/methods.
    if (pathname === "/quiz") return withPrivateHeaders(await serveQuickScan(request));
    const privateRequest = privatePage.test(pathname) || pathname.startsWith("/api/") || ["token", "session", "team"].some(key => url.searchParams.has(key));
    if (privateRequest) return withPrivateHeaders(await env.ASSETS.fetch(request));
    if (request.method === "GET" || request.method === "HEAD") {
      const normalized = pathname.replace(/\/$/, "");
      const destination = aliases[normalized];
      if (destination) {
        url.pathname = destination;
        return Response.redirect(url.toString(), 301);
      }
      // Only canonicalize the public host. Account/API/quiz requests remain untouched.
      if (url.hostname === "www.neurobusiness.one") {
        url.hostname = "neurobusiness.one";
        return Response.redirect(url.toString(), 301);
      }
      if (marketingAssets[normalized]) {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = marketingAssets[normalized];
        let response = await env.ASSETS.fetch(new Request(assetUrl, request));
        // Pages may canonicalize .html paths. Resolve only that internal asset redirect.
        if ([301,302,307,308].includes(response.status)) {
          const location = response.headers.get("location");
          const target = location && new URL(location, assetUrl);
          if (target && target.origin === assetUrl.origin && target.pathname === assetUrl.pathname.replace(/\.html$/, "")) {
            response = await env.ASSETS.fetch(new Request(target, request));
          }
        }
        return response;
      }
    }
    return env.ASSETS.fetch(request);
  },
};
