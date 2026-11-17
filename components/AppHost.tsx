"use client";

import { useEffect } from "react";
import { pickBridge } from "@/lib/appHost/bridge";
import { localApi } from "@/lib/appHost/localApi";

// Only in the app bundle (docs/app-bundle.md). The layout's first script has
// already made every "/api/..." request wait in a queue; this hands them, and
// all later ones, to the device's own answerer.
type HostWindow = Window & { __obHost?: (path: string, init?: RequestInit) => Promise<Response>; __obHostReady?: () => void };

export default function AppHost() {
  useEffect(() => {
    const w = window as HostWindow;
    if (w.__obHost) return;
    w.__obHost = localApi(pickBridge());
    w.__obHostReady?.();
  }, []);
  return null;
}

// Runs before anything else on the page: requests to this origin's /api wait
// for the host, then go to it. Everything else is the browser's own fetch.
export const APP_FETCH_SCRIPT = `(function(){
  var real=window.fetch.bind(window),waiting=[];
  window.__obHostReady=function(){var q=waiting;waiting=[];q.forEach(function(run){run()})};
  window.fetch=function(input,init){
    var url=typeof input==="string"?input:(input&&input.url)||String(input);
    var path=url.indexOf(location.origin)===0?url.slice(location.origin.length):url;
    if(path.indexOf("/api/")!==0)return real(input,init);
    return new Promise(function(resolve,reject){
      var run=function(){window.__obHost(path,init).then(resolve,reject)};
      if(window.__obHost)run();else waiting.push(run);
    });
  };
})();`;
