// Admin updates: what this person hasn't seen yet. "Seen" is per device (localStorage), which is
// all the badge and banner need; the posts themselves live in Supabase (announcements).
// One subscription for the whole app: Shell runs useUpdates and shares it through UpdatesCtx.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase.js'

const key = (uid) => `wander-seen-updates:${uid}`
export const getSeen = (uid) => {
  try {
    return localStorage.getItem(key(uid)) ?? ''
  } catch {
    return ''
  }
}
export function markUpdatesSeen(uid) {
  try {
    localStorage.setItem(key(uid), new Date().toISOString())
  } catch {
    /* private mode: the badge just stays */
  }
  dispatchEvent(new Event('wander-updates-seen'))
}

export function useUpdates(uid) {
  const [posts, setPosts] = useState([])
  const [seen, setSeen] = useState(() => getSeen(uid))
  const load = useCallback(async () => {
    const { data } = await supabase.from('announcements').select('id, title, body, audience, pinned, created_at').order('created_at', { ascending: false }).limit(20)
    if (data) setPosts(data)
  }, [])
  useEffect(() => {
    load()
    const ch = supabase.channel('updates').on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, load).subscribe()
    const onSeen = () => setSeen(getSeen(uid))
    addEventListener('wander-updates-seen', onSeen)
    return () => (supabase.removeChannel(ch), removeEventListener('wander-updates-seen', onSeen))
  }, [load, uid])
  const unread = posts.filter((p) => p.created_at > seen)
  return { posts, unread, latest: unread[0] ?? null }
}

export const UpdatesCtx = createContext({ posts: [], unread: [], latest: null })
export const useUpdatesFeed = () => useContext(UpdatesCtx)
