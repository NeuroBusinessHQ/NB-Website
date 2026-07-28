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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/quiz") {
      return serveQuickScan(request);
    }

    return env.ASSETS.fetch(request);
  },
};
