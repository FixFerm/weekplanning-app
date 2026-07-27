// Zorgt dat de app op je telefoon ook opengaat zonder bereik. De weekplanning zelf
// staat in de opslag van de app, dus je ziet altijd je week, ook zonder verbinding.
//
// Let op: dit werkt alleen op een beveiligde verbinding (https). Op http bestaat dit
// niet; dan opent het icoontje niets zodra je geen bereik hebt.

const VERSIE = "weekplanning-2";
const NODIG = [
  "./", "./index.html", "./app.js", "./stijl.css", "./vendor/qr.js",
  "./manifest.webmanifest", "./icoon-192.png", "./icoon-512.png",
  "./fonts/Poppins-Regular.ttf", "./fonts/Poppins-Medium.ttf",
  "./fonts/Poppins-SemiBold.ttf", "./fonts/Poppins-Bold.ttf",
  "./fonts/Poppins-ExtraBold.ttf",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSIE).then((c) => c.addAll(NODIG)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== VERSIE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Lettertypes en plaatjes veranderen nooit: die mogen meteen uit de bewaarde kopie.
const VAST = /\.(ttf|png|webmanifest)$/i;

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  // De app zelf (de pagina, app.js, de stijl) halen we ALTIJD eerst vers op. Dat moet:
  // die bestanden houden hun naam, dus als we de bewaarde kopie voorrang geven blijft
  // een reparatie op je telefoon staan tot je hem twee keer opent. Geen bereik? Dan
  // pakken we alsnog de bewaarde kopie, zodat de app het buiten gewoon doet.
  if (!VAST.test(url.pathname)) {
    e.respondWith(
      fetch(e.request)
        .then((antwoord) => {
          if (antwoord && antwoord.ok) caches.open(VERSIE).then((c) => c.put(e.request, antwoord.clone()));
          return antwoord;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true })
          .then((gevonden) => gevonden || caches.match("./index.html"))),
    );
    return;
  }

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((gevonden) => {
      const vers = fetch(e.request).then((antwoord) => {
        if (antwoord && antwoord.ok) caches.open(VERSIE).then((c) => c.put(e.request, antwoord.clone()));
        return antwoord;
      }).catch(() => gevonden || caches.match("./index.html"));
      return gevonden || vers;
    }),
  );
});
