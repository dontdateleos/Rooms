const SHELL="rooms-shell-v1", ASSETS=["./","./index.html","./manifest.webmanifest"];
self.addEventListener("install",e=>e.waitUntil(caches.open(SHELL).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{const u=new URL(e.request.url); if(u.origin!==location.origin) return;
  e.respondWith(fetch(e.request).then(r=>{const c=r.clone(); caches.open(SHELL).then(x=>x.put(e.request,c)); return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true})));});
