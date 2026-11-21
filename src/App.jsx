import { Component, lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router'
import { MotionConfig, motion } from 'motion/react'
import { BarChart3, BedDouble, Boxes, CalendarClock, ChefHat, LayoutDashboard, LogOut, ReceiptText, ShoppingBag, UsersRound } from 'lucide-react'
import { configured } from './lib/supabase.js'
import { AuthProvider, ROLE_LABEL, useAuth } from './auth.jsx'
import { ToastProvider } from './components/ui.jsx'
import Login, { NoAccess, Setup, Booting } from './pages/Login.jsx'
import Register from './pages/Register.jsx'
// Manager pages load on demand, so the counter tablet never downloads them.
const Overview = lazy(() => import('./pages/Overview.jsx'))
const Orders = lazy(() => import('./pages/Orders.jsx'))
const Schedule = lazy(() => import('./pages/Schedule.jsx'))
const Bookings = lazy(() => import('./pages/Bookings.jsx'))
const Sales = lazy(() => import('./pages/Sales.jsx'))
const Inventory = lazy(() => import('./pages/Inventory.jsx'))
const Analytics = lazy(() => import('./pages/Analytics.jsx'))
const Staff = lazy(() => import('./pages/Staff.jsx'))

const ALL = ['admin', 'manager', 'staff']
// [label, path, icon, roles that see it]. The database enforces the same split.
const MANAGERS = ['admin', 'manager']
const NAV = [
  ['Overview', '/', LayoutDashboard, MANAGERS],
  ['Orders', '/orders', ChefHat, ALL],
  ['Register', '/register', ShoppingBag, ALL],
  ['Bookings', '/bookings', BedDouble, ALL],
  ['Sales', '/sales', ReceiptText, ALL],
  ['Inventory', '/inventory', Boxes, ALL],
  ['Schedule', '/schedule', CalendarClock, ALL],
  ['Analytics', '/analytics', BarChart3, MANAGERS],
  ['Staff', '/staff', UsersRound, ['admin']],
]

export default function App() {
  if (!configured) return <Setup />
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <BrowserRouter>
          <ToastProvider>
            <Gate />
          </ToastProvider>
        </BrowserRouter>
      </AuthProvider>
    </MotionConfig>
  )
}

function Gate() {
  const { session, profile, isStaff } = useAuth()
  if (session === undefined || (session && profile === undefined)) return <Booting />
  if (!session) return <Login />
  return isStaff ? <Shell /> : <NoAccess />
}

function Shell() {
  const { profile, isManager, isAdmin, signOut } = useAuth()
  const nav = NAV.filter((n) => n[3].includes(profile.role))
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[4.75rem_minmax(0,1fr)] xl:grid-cols-[14.5rem_minmax(0,1fr)]">
      <aside className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-roast px-3 text-paper lg:h-dvh lg:flex-col lg:items-stretch lg:gap-0 lg:px-3 lg:py-5">
        <div className="flex shrink-0 items-center gap-2.5 lg:mb-8 lg:justify-center xl:justify-start xl:px-2">
          <img src="/favicon.svg" alt="" className="size-9 shrink-0" />
          <span className="leading-none max-sm:hidden lg:hidden xl:block">
            <span className="block font-display text-xl font-semibold tracking-[-0.01em]">Wander</span>
            <span className="text-[0.7rem] font-bold tracking-[0.14em] text-foam uppercase">Cafe + B&amp;B</span>
          </span>
        </div>
        <nav aria-label="Main" className="flex min-w-0 flex-1 gap-1 overflow-x-auto lg:flex-none lg:flex-col lg:overflow-visible">
          {nav.map(([label, to, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} title={label} aria-label={label} className="group relative flex h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm font-bold lg:h-11 lg:justify-center xl:justify-start">
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="nav-brush" className="brush absolute inset-x-0 inset-y-0.5" transition={{ type: 'spring', duration: 0.35, bounce: 0 }} />}
                  <Icon className={`relative size-[1.15rem] shrink-0 transition-colors duration-150 ${isActive ? 'text-roast' : 'text-foam group-hover:text-paper'}`} aria-hidden="true" />
                  <span aria-hidden="true" className={`relative hidden transition-colors duration-150 xl:inline ${isActive ? 'text-roast' : 'text-foam group-hover:text-paper'}`}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2 lg:mt-auto lg:flex-col lg:items-stretch">
          <p className="min-w-0 text-right text-sm leading-tight max-sm:hidden lg:hidden xl:block xl:px-2 xl:text-left">
            <span className="block truncate font-semibold">{profile.full_name}</span>
            <span className="text-xs font-bold tracking-[0.1em] text-tiffany uppercase">{ROLE_LABEL[profile.role]}</span>
          </p>
          <button type="button" onClick={signOut} title="Sign out" className="press flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-foam ring-1 ring-paper/10 hover:text-paper xl:justify-start">
            <LogOut className="size-4" aria-hidden="true" />
            <span className="hidden xl:inline">Sign out</span>
            <span className="sr-only xl:hidden">Sign out</span>
          </button>
        </div>
      </aside>
      <div className="min-w-0">
        <Crash>
        <Suspense fallback={null}>
          <Routes>
            {/* Admins and managers start on the Overview; staff start on the order board. */}
            <Route path="/" element={isManager ? <Overview /> : <Navigate to="/orders" replace />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/register" element={<Register />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/bookings/*" element={<Bookings />} />
            <Route path="/sales" element={<Sales />} />
            <Route path="/inventory" element={<Inventory />} />
            {isManager && <Route path="/analytics/*" element={<Analytics />} />}
            {isAdmin && <Route path="/staff" element={<Staff />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        </Crash>
      </div>
    </div>
  )
}

// A page that crashes shows what broke instead of a blank screen; the nav stays usable.
class Crash extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <main role="alert" className="grid min-h-[70dvh] place-items-center px-4 text-center">
        <div className="max-w-md">
          <h1 className="font-display text-3xl font-semibold">This page hit a problem</h1>
          <p className="mt-2 text-bean">Nothing was lost. Reload to try again, and if it keeps happening, send this to whoever set up the dashboard:</p>
          <code className="mt-3 block rounded-lg bg-paper px-3 py-2 text-sm text-tomato ring-1 ring-parchment">{String(this.state.error?.message ?? this.state.error)}</code>
          <button type="button" onClick={() => location.reload()} className="press mt-5 h-11 rounded-lg bg-teal-deep px-5 font-semibold text-paper">Reload</button>
        </div>
      </main>
    )
  }
}
