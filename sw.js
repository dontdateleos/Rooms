const SHELL="rooms-shell-v2", ASSETS=["./","./index.html","./manifest.webmanifest","./vendor/type.css"];
self.addEventListener("install",e=>e.waitUntil(caches.open(SHELL).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
/* network first, cache as the fallback for when there is no network. Opening the app asks
   the server to confirm the page is current rather than trusting the browser's own copy
   for another ten minutes — that copy is why a phone kept showing an old version. Only
   GETs go in the cache; anything else can't be stored and was failing quietly. */
self.addEventListener("fetch",e=>{const u=new URL(e.request.url); if(u.origin!==location.origin||e.request.method!=="GET") return;
  const req=e.request.mode==="navigate"?new Request(e.request.url,{cache:"no-cache",credentials:"same-origin"}):e.request;
  e.respondWith(fetch(req).then(r=>{const c=r.clone(); if(r.ok) caches.open(SHELL).then(x=>x.put(e.request,c)); return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true})));});
