'use strict';

const CACHE = 'unkoyoke-v4';

// Absolute paths matching the GitHub Pages deployment at /pwa-game/
const BASE = '/pwa-game';
const ASSETS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/style.css',
  BASE + '/game.js',
  BASE + '/manifest.json',
  BASE + '/icons/apple-touch-icon.png',
  BASE + '/icons/icon-192.png',
  BASE + '/icons/icon-512.png',
];

// ---- Install: pre-cache all assets ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ---- Activate: remove old caches ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---- Fetch: cache-first strategy ----
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
