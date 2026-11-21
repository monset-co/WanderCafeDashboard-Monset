import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, BellOff, BellRing, Download, Share, SquarePlus } from 'lucide-react'
import { disablePush, enablePush, install, isIOS, useDevice } from '../lib/device.js'
import { BTN, CARD, EASE_OUT, useToast } from './ui.jsx'

// Install + notifications, compact, for the sidebar / top bar. Hidden once there's nothing to do.
export function DeviceButtons() {
  const d = useDevice()
  const notify = useToast()
  const [busy, setBusy] = useState(false)
  const [iosHelp, setIosHelp] = useState(false)
  const showInstall = !d.installed && (d.canInstall || isIOS)
  const on = d.subscribed && d.permission === 'granted'

  const toggle = async () => {
    setBusy(true)
    if (on) {
      await disablePush()
      notify('Notifications off on this device')
    } else {
      const err = await enablePush()
      notify(err ?? 'Notifications on. A test is on its way.', { tone: err ? 'bad' : 'ok' })
    }
    setBusy(false)
  }
  const doInstall = async () => (isIOS && !d.canInstall ? setIosHelp(true) : install())

  const btn = 'press relative flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold ring-1 ring-paper/10 xl:justify-start'
  return (
    <>
      {showInstall && (
        <button type="button" onClick={doInstall} title="Install the app" className={`${btn} text-tiffany hover:text-paper`}>
          <Download className="size-4 shrink-0" aria-hidden="true" />
          <span className="hidden xl:inline">Install app</span>
          <span className="sr-only xl:hidden">Install app</span>
        </button>
      )}
      <button type="button" onClick={toggle} disabled={busy} aria-pressed={on} title={on ? 'Turn notifications off' : 'Turn notifications on'} className={`${btn} ${on ? 'text-foam hover:text-paper' : 'text-tiffany hover:text-paper'} disabled:opacity-50`}>
        {on ? <BellRing className="size-4 shrink-0" aria-hidden="true" /> : <Bell className="size-4 shrink-0" aria-hidden="true" />}
        <span className="hidden xl:inline">{on ? 'Notifications on' : 'Turn on notifications'}</span>
        <span className="sr-only xl:hidden">{on ? 'Notifications on' : 'Turn on notifications'}</span>
      </button>
      <AnimatePresence>{iosHelp && <IosInstall onClose={() => setIosHelp(false)} />}</AnimatePresence>
    </>
  )
}

// Safari has no install prompt: show the two taps.
function IosInstall({ onClose }) {
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-end bg-roast/50 p-3 sm:place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} onClick={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ios-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-paper p-6 text-espresso shadow-[0_24px_60px_-20px_rgb(51_36_28/0.7)]"
        initial={{ transform: 'translateY(24px)' }}
        animate={{ transform: 'translateY(0px)' }}
        transition={{ duration: 0.3, ease: EASE_OUT }}
      >
        <h2 id="ios-title" className="text-lg font-bold">Install on iPhone or iPad</h2>
        <ol className="mt-4 space-y-3 text-sm">
          <li className="flex items-center gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-cream"><Share className="size-4" aria-hidden="true" /></span>Tap <b>Share</b> in Safari’s toolbar.</li>
          <li className="flex items-center gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-cream"><SquarePlus className="size-4" aria-hidden="true" /></span>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          <li className="flex items-center gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-cream"><Bell className="size-4" aria-hidden="true" /></span>Open Wander from the home screen and turn notifications on there.</li>
        </ol>
        <button type="button" onClick={onClose} autoFocus className={`${BTN.primary} mt-6 w-full`}>Got it</button>
      </motion.div>
    </motion.div>
  )
}

// The fuller version, for the Updates page: what each does and where this device stands.
export function DeviceCard() {
  const d = useDevice()
  const on = d.subscribed && d.permission === 'granted'
  return (
    <section className={`${CARD} p-5`}>
      <h2 className="font-bold">This device</h2>
      <ul className="mt-3 space-y-2 text-sm">
        <li className="flex items-center gap-2">
          <Download className="size-4 text-teal" aria-hidden="true" />
          {d.installed ? 'Installed as an app.' : 'Not installed. Installing puts Wander on the home screen and opens it full screen.'}
        </li>
        <li className="flex items-center gap-2">
          {on ? <BellRing className="size-4 text-teal" aria-hidden="true" /> : d.permission === 'denied' ? <BellOff className="size-4 text-tomato" aria-hidden="true" /> : <Bell className="size-4 text-teal" aria-hidden="true" />}
          {on ? 'Notifications on: updates and new bookings arrive here.' : d.permission === 'denied' ? 'Notifications are blocked in this browser’s site settings.' : 'Notifications off.'}
        </li>
      </ul>
      <div className="mt-4 flex flex-wrap gap-2 rounded-xl bg-roast p-2">
        <DeviceButtons />
      </div>
    </section>
  )
}
