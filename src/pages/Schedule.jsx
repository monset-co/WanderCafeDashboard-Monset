import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { addDays, fmtDay, manilaToday, plural } from '../lib/util.js'
import { BTN, CARD, FIELD, LABEL, PageHeader, Problem, Sheet, SkeletonRows, Submit, useToast } from '../components/ui.jsx'
import { useAuth } from '../auth.jsx'

const STATIONS = ['Counter', 'Barista', 'Kitchen', 'Front desk', 'Housekeeping']
const monday = (d) => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7))
const hhmm = (t) => t.slice(0, 5)
const clock = (t) => {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'a' : 'p'}`
}
const hours = (s) => {
  const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5)
  return (toMin(s.end_time) - toMin(s.start_time)) / 60
}

export default function Schedule() {
  const { isManager, session } = useAuth()
  const notify = useToast()
  const t = manilaToday()
  const [week, setWeek] = useState(monday(t))
  const [people, setPeople] = useState(null)
  const [shifts, setShifts] = useState(null)
  const [error, setError] = useState(null)
  const [edit, setEdit] = useState(null) // a shift, or { staff_id, shift_date } for a new one
  const [copying, setCopying] = useState(false)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week])

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      supabase.from('profiles').select('id, full_name, role').neq('role', 'inactive').order('full_name'),
      supabase.from('shifts').select('*').gte('shift_date', week).lte('shift_date', addDays(week, 6)).order('start_time'),
    ])
    if (p.error || s.error) return setError((p.error ?? s.error).message)
    setError(null)
    setPeople(p.data)
    setShifts(s.data)
  }, [week])
  useEffect(() => {
    setShifts(null)
    load()
  }, [load])

  // Copy last week's shifts into this week. Anything that would overlap an existing shift is skipped.
  const copyLastWeek = async () => {
    setCopying(true)
    const { data, error } = await supabase.from('shifts').select('staff_id, shift_date, start_time, end_time, station, note').gte('shift_date', addDays(week, -7)).lte('shift_date', addDays(week, -1))
    if (error) return setCopying(false), notify(error.message, { tone: 'bad' })
    // One insert each, so a shift that overlaps is skipped without failing the rest.
    const results = await Promise.all(data.map((s) => supabase.from('shifts').insert({ ...s, shift_date: addDays(s.shift_date, 7) })))
    const made = results.filter((r) => !r.error).length
    setCopying(false)
    load()
    notify(data.length ? `Copied ${made} of ${data.length} shifts from last week${made < data.length ? ' (the rest overlapped)' : ''}` : 'Last week has no shifts to copy', { tone: data.length ? 'ok' : 'bad' })
  }

  const byCell = new Map()
  for (const s of shifts ?? []) byCell.set(s.staff_id + s.shift_date, [...(byCell.get(s.staff_id + s.shift_date) ?? []), s])
  const weekHours = (id) => (shifts ?? []).filter((s) => s.staff_id === id).reduce((h, s) => h + hours(s), 0)
  const onToday = (shifts ?? []).filter((s) => s.shift_date === t).length
  const range = `${fmtDay(days[0], { month: 'short', day: 'numeric' })} – ${fmtDay(days[6], { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <main className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <PageHeader title="Schedule" sub={isManager ? 'Tap a day to add a shift, or a shift to change it.' : 'Who’s working this week. Your row is highlighted.'}>
        {isManager && (
          <>
            <button type="button" onClick={copyLastWeek} disabled={copying || !shifts} className={BTN.quiet}>
              <Copy className="size-4" aria-hidden="true" /> {copying ? 'Copying…' : 'Copy last week'}
            </button>
            <button type="button" onClick={() => setEdit({ shift_date: days.includes(t) ? t : days[0] })} className={BTN.primary}>
              <Plus className="size-4" aria-hidden="true" /> Add shift
            </button>
          </>
        )}
      </PageHeader>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setWeek((w) => addDays(w, -7))} aria-label="Previous week" className="press grid size-10 place-items-center rounded-lg bg-paper ring-1 ring-parchment hover:ring-bean/40"><ChevronLeft className="size-5" aria-hidden="true" /></button>
        <h2 className="tabular min-w-56 text-center text-lg font-bold" aria-live="polite">{range}</h2>
        <button type="button" onClick={() => setWeek((w) => addDays(w, 7))} aria-label="Next week" className="press grid size-10 place-items-center rounded-lg bg-paper ring-1 ring-parchment hover:ring-bean/40"><ChevronRight className="size-5" aria-hidden="true" /></button>
        {week !== monday(t) && <button type="button" onClick={() => setWeek(monday(t))} className="press rounded-lg px-3 py-2 text-sm font-bold text-teal-deep hover:bg-teal/10">This week</button>}
        {days.includes(t) && shifts && <p className="ml-auto text-sm text-bean">{onToday ? `${plural(onToday, 'shift')} today` : 'Nobody scheduled today'}</p>}
      </div>

      {error && <div className="mt-4"><Problem onRetry={load}>Couldn't load the schedule. {error}</Problem></div>}
      <div className={`${CARD} mt-4 overflow-x-auto`}>
        {!shifts && !error && <SkeletonRows rows={4} label="Loading the schedule" />}
        {shifts && people && (
          <table className="w-full min-w-[60rem] table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-parchment">
                <th scope="col" className="w-44 px-4 py-3 text-left text-xs font-bold tracking-[0.08em] text-bean uppercase">Team</th>
                {days.map((d) => (
                  <th key={d} scope="col" className={`px-2 py-3 text-left font-bold ${d === t ? 'text-teal-deep' : ''}`}>
                    <span className="block text-xs tracking-[0.08em] uppercase">{fmtDay(d, { weekday: 'short' })}</span>
                    <span className={`tabular mt-0.5 inline-grid size-7 place-items-center rounded-full ${d === t ? 'bg-teal-deep text-paper' : ''}`}>{+d.slice(8)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-parchment/60">
              {people.map((p) => {
                const me = p.id === session.user.id
                return (
                  <tr key={p.id} className={me ? 'bg-tiffany/12' : ''}>
                    <th scope="row" className="px-4 py-3 text-left align-top">
                      <span className="block truncate font-bold">{p.full_name}{me && <span className="ml-1 text-xs font-semibold text-bean">(you)</span>}</span>
                      <span className="tabular text-xs font-semibold text-bean">{weekHours(p.id) ? `${+weekHours(p.id).toFixed(1)} h this week` : 'No shifts'}</span>
                    </th>
                    {days.map((d) => {
                      const list = byCell.get(p.id + d) ?? []
                      return (
                        <td key={d} className={`group h-20 px-1.5 py-1.5 align-top ${d === t ? 'bg-teal/5' : ''}`}>
                          <div className="flex h-full flex-col gap-1">
                            {list.map((s) => {
                              const chip = (
                                <>
                                  <span className="tabular block font-bold">{clock(s.start_time)}–{clock(s.end_time)}</span>
                                  <span className="block truncate text-teal-deep">{s.station}</span>
                                </>
                              )
                              return isManager ? (
                                <button key={s.id} type="button" onClick={() => setEdit(s)} title={s.note || undefined} className="press rounded-md border border-teal/30 bg-paper px-2 py-1 text-left text-xs hover:border-teal-deep">{chip}</button>
                              ) : (
                                <div key={s.id} title={s.note || undefined} className="rounded-md border border-teal/30 bg-paper px-2 py-1 text-xs">{chip}</div>
                              )
                            })}
                            {isManager && (
                              <button type="button" onClick={() => setEdit({ staff_id: p.id, shift_date: d })} aria-label={`Add a shift for ${p.full_name} on ${fmtDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}`} className="press grid min-h-7 flex-1 place-items-center rounded-md text-teal-deep opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-teal/10">
                                <Plus className="size-4" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <AnimatePresence>
        {edit && people && <ShiftForm key="shift" shift={edit} people={people} onClose={() => setEdit(null)} onSaved={(msg) => (setEdit(null), load(), notify(msg))} />}
      </AnimatePresence>
    </main>
  )
}

function ShiftForm({ shift, people, onClose, onSaved }) {
  const existing = Boolean(shift.id)
  const [f, setF] = useState({
    staff_id: shift.staff_id ?? people[0]?.id ?? '',
    shift_date: shift.shift_date,
    start_time: shift.start_time ? hhmm(shift.start_time) : '07:00',
    end_time: shift.end_time ? hhmm(shift.end_time) : '15:00',
    station: shift.station ?? 'Counter',
    note: shift.note ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const name = people.find((p) => p.id === f.staff_id)?.full_name ?? 'them'
  const len = f.end_time > f.start_time ? hours({ start_time: f.start_time, end_time: f.end_time }) : 0

  const save = async (e) => {
    e.preventDefault()
    if (!len) return setErr('The shift has to end after it starts.')
    setBusy(true)
    setErr(null)
    const row = { ...f, station: f.station.trim() || 'Counter', note: f.note.trim() }
    const { error } = existing ? await supabase.from('shifts').update(row).eq('id', shift.id) : await supabase.from('shifts').insert(row)
    setBusy(false)
    if (error) return setErr(/shifts_no_overlap/.test(error.message) ? `${name} already has a shift that overlaps those hours.` : error.message)
    onSaved(`${name}: ${fmtDay(f.shift_date, { weekday: 'short', month: 'short', day: 'numeric' })}, ${clock(f.start_time)}–${clock(f.end_time)}`)
  }
  const remove = async () => {
    setBusy(true)
    const { error } = await supabase.from('shifts').delete().eq('id', shift.id)
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved(`Shift removed for ${name}`)
  }

  return (
    <Sheet title={existing ? 'Edit shift' : 'New shift'} subtitle={fmtDay(f.shift_date, { weekday: 'long', month: 'long', day: 'numeric' })} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <label className={LABEL}>
          Who
          <select value={f.staff_id} onChange={set('staff_id')} className={`${FIELD} mt-1.5`}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className={LABEL}>Date<input type="date" value={f.shift_date} onChange={set('shift_date')} className={`${FIELD} tabular mt-1.5`} /></label>
          <label className={LABEL}>Starts<input type="time" step="900" value={f.start_time} onChange={set('start_time')} className={`${FIELD} tabular mt-1.5`} /></label>
          <label className={LABEL}>Ends<input type="time" step="900" value={f.end_time} onChange={set('end_time')} className={`${FIELD} tabular mt-1.5`} /></label>
        </div>
        <p className="tabular text-sm text-bean">{len ? `${+len.toFixed(2)} hours` : 'The end has to be after the start (overnight shifts: split at midnight).'}</p>
        <fieldset>
          <legend className={LABEL}>Station</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {STATIONS.map((s) => (
              <button key={s} type="button" aria-pressed={f.station === s} onClick={() => setF((x) => ({ ...x, station: s }))} className={`press h-9 rounded-full px-3.5 text-sm font-bold ${f.station === s ? 'bg-espresso text-paper' : 'text-bean ring-1 ring-parchment hover:text-espresso'}`}>{s}</button>
            ))}
          </div>
        </fieldset>
        <label className={LABEL}>Note <span className="font-normal text-bean">(optional)</span><input value={f.note} onChange={set('note')} placeholder="Opening, inventory count, training…" className={`${FIELD} mt-1.5`} /></label>
        {err && <Problem>{err}</Problem>}
        <Submit busy={busy}>{existing ? 'Save shift' : 'Add shift'}</Submit>
        {existing && (
          <button type="button" onClick={remove} disabled={busy} className="press flex h-11 w-full items-center justify-center gap-2 rounded-lg font-semibold text-tomato ring-1 ring-tomato/30 hover:bg-tomato/10">
            <Trash2 className="size-4" aria-hidden="true" /> Remove shift
          </button>
        )}
      </form>
    </Sheet>
  )
}
