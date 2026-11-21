// This phone/computer: installing the app, and turning push notifications on or off.
import { useSyncExternalStore } from 'react'
import { serverApi, supabase } from './supabase.js'

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY
const ua = navigator.userAgent
export const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true

let state = {
  installed: standalone(),
  canInstall: false, // the browser offered its install prompt (Chrome, Edge, Android)
  pushSupported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  pushReady: Boolean(VAPID),
  permission: 'Notification' in window ? Notification.permission : 'denied',
  subscribed: false,
}
const listeners = new Set()
const set = (patch) => {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}
export const useDevice = () => useSyncExternalStore((fn) => (listeners.add(fn), () => listeners.delete(fn)), () => state)

// Captured as early as possible: the browser fires it once, often before React is up.
let promptEvent = null
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  promptEvent = e
  set({ canInstall: true })
})
addEventListener('appinstalled', () => set({ installed: true, canInstall: false }))
matchMedia('(display-mode: standalone)').addEventListener?.('change', () => set({ installed: standalone() }))

export async function install() {
  if (!promptEvent) return false
  promptEvent.prompt()
  const { outcome } = await promptEvent.userChoice
  promptEvent = null
  set({ canInstall: false, installed: outcome === 'accepted' || state.installed })
  return outcome === 'accepted'
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => reg.pushManager?.getSubscription())
    .then((sub) => set({ subscribed: Boolean(sub) }))
    .catch(() => {})
}

const key = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))

// Ask permission, subscribe this device, save it for the signed-in person, then send a test.
// Returns an error message, or null when it worked.
export async function enablePush() {
  if (!state.pushSupported) return isIOS && !state.installed ? 'On iPhone and iPad, install the app first (Share › Add to Home Screen), then open it from the home screen and turn notifications on there.' : 'This browser can’t receive notifications.'
  if (!state.pushReady) return 'Notifications aren’t set up on the server yet (VITE_VAPID_PUBLIC_KEY is missing). Ask whoever set up the dashboard.'
  const permission = await Notification.requestPermission()
  set({ permission })
  if (permission !== 'granted') return permission === 'denied' ? 'Notifications are blocked for this site. Allow them in the browser’s site settings, then try again.' : 'Notifications weren’t allowed.'
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(VAPID) }))
    const { p256dh, auth } = sub.toJSON().keys
    const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: sub.endpoint, p_p256dh: p256dh, p_auth: auth, p_user_agent: ua })
    if (error) return error.message
    set({ subscribed: true })
    const test = await serverApi('/api/notify', { kind: 'test' })
    return test.error ? `Turned on, but the test didn’t send: ${test.error}` : null
  } catch (e) {
    return `Couldn’t turn notifications on: ${e.message}`
  }
}

export async function disablePush() {
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription()
    if (sub) {
      await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint })
      await sub.unsubscribe()
    }
  } catch {
    /* already gone */
  }
  set({ subscribed: false })
}

// Ask the server to push something to the team (an update, a booking). Failures don't block the action.
export const notifyTeam = (body) => serverApi('/api/notify', body).catch(() => null)
