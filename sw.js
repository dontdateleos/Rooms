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
/* a notification from a friend: show it, and a tap opens Rooms where it happened. The tag
   means a second "vote on Saturday" replaces the first rather than stacking up. */
self.addEventListener("push",e=>{let n={}; try{n=e.data?e.data.json():{};}catch{n={body:e.data&&e.data.text()};}
  e.waitUntil(self.registration.showNotification(n.title||"Rooms",{body:n.body||"",tag:n.tag||undefined,renotify:!!n.tag,
    icon:"./icons/rooms-192.png",badge:"./icons/rooms-mask-192.png",data:{url:n.url||"./"}}));});
self.addEventListener("notificationclick",e=>{e.notification.close(); const url=e.notification.data&&e.notification.data.url||"./";
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(cs=>{
    const open=cs.find(c=>c.url.startsWith(self.registration.scope));
    if(open) return open.navigate(url).then(c=>(c||open).focus()).catch(()=>open.focus());
    return self.clients.openWindow(url);}));});
