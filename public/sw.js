// Wander Dashboard service worker: makes the app installable, opens it offline, and shows push notifications.
// Data (Supabase) and /api/* always go to the network; only the app's own files are cached.
const CACHE = 'wander-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return
  // Built files have content hashes in their names: cache first, they never change.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request).then((res) => (res.ok && caches.open(CACHE).then((c) => c.put(e.request, res.clone())), res))))
    return
  }
  // Pages: network first so a deploy shows up at once; the cached app if offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((res) => (res.ok && caches.open(CACHE).then((c) => c.put('/', res.clone())), res)).catch(() => caches.match('/')))
  }
})

self.addEventListener('push', (e) => {
  let m = {}
  try {
    m = e.data?.json() ?? {}
  } catch {
    m = { body: e.data?.text() }
  }
  e.waitUntil(
    self.registration.showNotification(m.title || 'Wander', {
      body: m.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: m.tag,
      renotify: Boolean(m.tag),
      data: { url: m.url || '/' },
    }),
  )
})

// Tapping a notification focuses the open dashboard (and goes to the page) or opens it.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || '/', location.origin).href
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(location.origin))
      return open ? open.focus().then((c) => c.navigate?.(url)) : self.clients.openWindow(url)
    }),
  )
})
