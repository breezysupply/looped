/* Offline cache. Bump CACHE when any asset below changes. */
var CACHE = 'looped-8b3225f4';
var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/style.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/js/store.js',
  './assets/js/shell.js',
  './assets/js/shell-containers.js',
  './assets/js/data/tracks.js',
  './assets/js/data/objectives.js',
  './assets/js/data/commands-core.js',
  './assets/js/data/commands-more.js',
  './assets/js/data/commands-net.js',
  './assets/js/data/commands-system.js',
  './assets/js/data/containers-docker.js',
  './assets/js/data/containers-drills.js',
  './assets/js/data/containers-k8s.js',
  './assets/js/data/containers-missions.js',
  './assets/js/data/containers-net.js',
  './assets/js/data/containers-outputs.js',
  './assets/js/data/containers-playbooks.js',
  './assets/js/data/drills-more.js',
  './assets/js/data/drills.js',
  './assets/js/data/labs-more.js',
  './assets/js/data/labs.js',
  './assets/js/data/missions.js',
  './assets/js/data/playbook-outputs.js',
  './assets/js/data/playbooks-more.js',
  './assets/js/data/playbooks.js',
  './assets/js/data/quiz-extra.js',
  './assets/js/data/scenarios-more.js',
  './assets/js/data/scenarios.js',
  './assets/js/lab.js',
  './assets/js/quiz.js',
  './assets/js/sandbox.js',
  './assets/js/playbook.js',
  './assets/js/review.js',
  './assets/js/app.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Cache-first, refreshing in the background so updates land on the next open. */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
