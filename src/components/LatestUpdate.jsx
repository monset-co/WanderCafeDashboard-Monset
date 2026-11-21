import { AnimatePresence, motion } from 'motion/react'
import { Megaphone } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useUpdatesFeed } from '../lib/updates.js'
import { BTN, EASE_OUT } from './ui.jsx'

// The newest unread admin update, as a banner that opens the Updates page.
export function LatestUpdate() {
  const { latest } = useUpdatesFeed()
  const navigate = useNavigate()
  return (
    <AnimatePresence>
      {latest && (
        <motion.button
          type="button"
          onClick={() => navigate('/updates')}
          initial={{ opacity: 0, transform: 'translateY(-6px)' }}
          animate={{ opacity: 1, transform: 'translateY(0px)' }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.25, ease: EASE_OUT }}
          className="press mt-6 flex w-full items-center gap-3 rounded-xl bg-tiffany/25 px-4 py-3 text-left ring-1 ring-tiffany"
        >
          <Megaphone className="size-5 shrink-0 text-teal-deep" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <b className="block truncate">{latest.title}</b>
            {latest.body && <span className="block truncate text-sm text-bean">{latest.body}</span>}
          </span>
          <span className={`${BTN.quiet} h-9 shrink-0 text-sm`}>Read</span>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
