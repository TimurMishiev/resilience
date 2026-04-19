// Shared helpers for <input type="datetime-local"> <-> ISO instant conversion.
// `datetime-local` renders and parses in the browser's local zone; the API
// expects UTC ISO strings. These two functions bridge the gap and are reused
// by every A-B compare surface that takes two operator-chosen timestamps.

export function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

export function fromDatetimeLocal(value: string): string {
  return new Date(value).toISOString()
}
