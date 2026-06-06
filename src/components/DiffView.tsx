import { computeDiff } from '../lib/version'

export default function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const segments = computeDiff(oldText, newText)
  return (
    <div style={{ fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6, padding: 16, overflow: 'auto' }}>
      {segments.map((seg, i) => {
        const bg = seg.added ? 'var(--added)' : seg.removed ? 'var(--removed)' : 'transparent'
        const color = seg.added ? 'var(--added-text)' : seg.removed ? 'var(--removed-text)' : 'var(--text-dim)'
        const prefix = seg.added ? '+ ' : seg.removed ? '- ' : '  '
        return seg.value
          .replace(/\n$/, '')
          .split('\n')
          .map((line, j) => (
            <div key={`${i}-${j}`} style={{ background: bg, color, whiteSpace: 'pre-wrap', padding: '0 6px' }}>
              {prefix}{line}
            </div>
          ))
      })}
    </div>
  )
}
