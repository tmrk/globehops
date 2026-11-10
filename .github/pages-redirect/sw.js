// GlobeHops moved from https://tmrk.github.io/globehops/ to https://globehops.marki.im/.
// This worker replaces the app's offline worker at the old address. Installed and returning
// visitors' browsers pick it up on their next update check and it activates at once. Activation
// only deletes GlobeHops's own caches (other sites share this origin) and takes control, because
// pages in scope wait for it. The old app then reloads itself, and every page load in scope is
// redirected to the same path, query and fragment at the new address. Windows still open a moment
// later are sent there too, and the worker unregisters itself.
var NEW_ORIGIN = 'https://globehops.marki.im';

function newAddress(address) {
  var url = new URL(address);
  return NEW_ORIGIN + (url.pathname.replace(/^\/globehops(?=\/|$)/, '') || '/') + url.search + url.hash;
}

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  var cleaned = caches
    .keys()
    .then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) {
            return key.indexOf('globehops-') === 0;
          })
          .map(function (key) {
            return caches.delete(key);
          }),
      );
    })
    .then(function () {
      return self.clients.claim();
    });
  event.waitUntil(cleaned);
  cleaned.then(function () {
    setTimeout(function () {
      self.clients
        .matchAll({ type: 'window' })
        .then(function (windows) {
          return Promise.all(
            windows.map(function (client) {
              return client.navigate(newAddress(client.url)).catch(function () {});
            }),
          );
        })
        .finally(function () {
          return self.registration.unregister();
        });
    }, 1500);
  });
});

self.addEventListener('fetch', function (event) {
  if (event.request.mode === 'navigate') event.respondWith(Response.redirect(newAddress(event.request.url), 301));
});
