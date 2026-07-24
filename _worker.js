const QUICK_SCAN_ORIGIN = "https://preview.neurobusiness.one";

async function serveQuickScan(request) {
  const requestUrl = new URL(request.url);
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

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
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
