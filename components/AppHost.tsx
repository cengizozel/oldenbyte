"use client";

import { useEffect } from "react";
import { fromBase64, pickBridge, toBase64, type Bridge, type NetInit } from "@/lib/appHost/bridge";
import { localApi } from "@/lib/appHost/localApi";

// Only in the app bundle (docs/app-bundle.md). The layout's first script has
// already made every "/api/..." request wait in a queue; this hands them, and
// all later ones, to the device's own answerer.
type HostWindow = Window & {
  __obHost?: (path: string, init?: RequestInit) => Promise<Response>;
  __obNet?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  __obHostReady?: () => void;
};

const TEXT = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|.*\+(json|xml)))/i;

// A request to somewhere else, made by the app itself and not by the page,
// so the browser's cross-origin rule does not apply: this is how the routes
// that run on the device reach the feeds, the weather and the user's own
// services, as a server would.
function appFetch(bridge: Bridge): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const send = bridge.fetch!;
  return async (input, init) => {
    const request = new Request(input, init);
    const headers = new Map<string, string>();
    request.headers.forEach((v, k) => headers.set(k.toLowerCase(), v));
    // Names the browser keeps to itself (the client's name, for one) are
    // dropped from a Request; they are sent as asked.
    const asked = init?.headers;
    if (asked) new Headers(asked).forEach((v, k) => headers.set(k.toLowerCase(), v));
    if (asked && !(asked instanceof Headers) && !Array.isArray(asked)) for (const [k, v] of Object.entries(asked)) headers.set(k.toLowerCase(), String(v));
    const out: NetInit = { method: request.method, headers: [...headers] };
    if (request.method !== "GET" && request.method !== "HEAD") {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length) {
        if (TEXT.test(headers.get("content-type") ?? "text/plain")) out.body = new TextDecoder().decode(bytes);
        else out.bodyBase64 = toBase64(bytes);
      }
    }
    if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const reply = await send(request.url, out);
    const body = reply.base64 !== undefined ? fromBase64(reply.base64) : reply.text ?? "";
    const empty = reply.status === 204 || reply.status === 205 || reply.status === 304;
    return new Response(empty ? null : body, { status: reply.status, statusText: reply.statusText, headers: reply.headers });
  };
}

export default function AppHost() {
  useEffect(() => {
    const w = window as HostWindow;
    if (w.__obHost) return;
    const bridge = pickBridge();
    if (bridge.fetch) w.__obNet = appFetch(bridge);
    w.__obHost = localApi(bridge);
    w.__obHostReady?.();
  }, []);
  return null;
}

// Runs before anything else on the page: requests to this origin's /api wait
// for the host, then go to it; requests to other sites go out through the app
// where there is one; the rest is the browser's own fetch. (No comments inside
// the script itself: it is put on the page as one line.)
export const APP_FETCH_SCRIPT = `(function(){
  var real=window.fetch.bind(window),waiting=[];
  window.__obHostReady=function(){var q=waiting;waiting=[];q.forEach(function(run){run()})};
  window.fetch=function(input,init){
    var url=typeof input==="string"?input:(input&&input.url)||String(input);
    var path=url.indexOf(location.origin)===0?url.slice(location.origin.length):url;
    if(path.indexOf("/api/")!==0){
      if(window.__obNet&&(path.indexOf("http://")===0||path.indexOf("https://")===0))return window.__obNet(input,init);
      return real(input,init);
    }
    return new Promise(function(resolve,reject){
      var run=function(){window.__obHost(path,init).then(resolve,reject)};
      if(window.__obHost)run();else waiting.push(run);
    });
  };
})();`;
