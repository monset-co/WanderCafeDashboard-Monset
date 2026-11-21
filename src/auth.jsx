import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'

const AuthCtx = createContext(null)
export const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', staff: 'Staff', inactive: 'No access' }

// session / profile: undefined = still loading, null = none.
// The database checks the role on every read and write; this only decides what to show.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [loaded, setLoaded] = useState(null) // { uid, full_name, role } for the last fetched user

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id
  useEffect(() => {
    if (!uid) return
    let live = true
    supabase
      .from('profiles')
      .select('full_name, role')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data, error }) => live && setLoaded({ uid, full_name: data?.full_name ?? session?.user.email, role: data?.role ?? 'inactive', error: error?.message ?? null }))
    return () => (live = false)
  }, [uid]) // eslint-disable-line react-hooks/exhaustive-deps

  // Derived, so a just-arrived session never renders against a missing or previous user's profile.
  const profile = session === undefined ? undefined : !uid ? null : loaded?.uid === uid ? loaded : undefined
  const role = profile?.role
  const value = {
    session,
    profile,
    isAdmin: role === 'admin',
    isManager: role === 'admin' || role === 'manager',
    isStaff: role === 'admin' || role === 'manager' || role === 'staff',
    // A shared tablet stops getting this person's notifications when they sign out.
    signOut: async () => {
      try {
        const sub = await (await navigator.serviceWorker?.ready)?.pushManager?.getSubscription()
        if (sub) await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint })
      } catch {
        /* nothing to remove */
      }
      return supabase.auth.signOut()
    },
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
