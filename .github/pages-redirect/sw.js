// GlobeHops moved from https://tmrk.github.io/globehops/ to https://globehops.marki.im/.
// This worker replaces the app's offline worker at the old address. Installed and returning
// visitors' browsers pick it up on their next update check; it activates at once, deletes only
// GlobeHops's own caches (other sites share this origin), sends open windows to the same page at
// the new address and unregisters itself.
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      await self.clients.claim();
      var keys = await caches.keys();
      await Promise.all(
        keys
          .filter(function (key) {
            return key.indexOf('globehops-') === 0;
          })
          .map(function (key) {
            return caches.delete(key);
          }),
      );
      var windows = await self.clients.matchAll({ type: 'window' });
      await Promise.all(
        windows.map(function (client) {
          var url = new URL(client.url);
          var path = url.pathname.replace(/^\/globehops(?=\/|$)/, '') || '/';
          return client.navigate('https://globehops.marki.im' + path + url.search + url.hash).catch(function () {});
        }),
      );
      await self.registration.unregister();
    })(),
  );
});
