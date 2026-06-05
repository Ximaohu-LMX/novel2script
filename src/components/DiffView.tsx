import { computeDiff } from '../lib/version'
import type { DiffReview, DiffReviewHunk } from '../lib/diffReview'

interface Props {
  oldText: string
  newText: string
  review?: DiffReview | null
  warning?: string
  onAcceptHunk?: (id: string) => void
  onRejectHunk?: (id: string) => void
  onResetHunk?: (id: string) => void
}

export default function DiffView({
  oldText,
  newText,
  review,
  warning,
  onAcceptHunk,
  onRejectHunk,
  onResetHunk,
}: Props) {
  if (review) {
    return (
      <div style={wrap}>
        {warning && (
          <div style={warningBox}>
            Schema 提醒:{warning}
          </div>
        )}
        {review.chunks.map((chunk, i) => {
          if (chunk.type === 'context') return renderPlainLines(chunk.text, `ctx-${i}`)
          return (
            <HunkBlock
              key={chunk.hunk.id}
              hunk={chunk.hunk}
              onAccept={onAcceptHunk}
              onReject={onRejectHunk}
              onReset={onResetHunk}
            />
          )
        })}
        {review.chunks.every((chunk) => chunk.type === 'context') && (
          <p className="muted" style={{ fontFamily: 'var(--sans)', padding: 12 }}>AI 没有产生可审阅的改动。</p>
        )}
      </div>
    )
  }

  const segments = computeDiff(oldText, newText)
  return (
    <div style={wrap}>
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

function HunkBlock({
  hunk,
  onAccept,
  onReject,
  onReset,
}: {
  hunk: DiffReviewHunk
  onAccept?: (id: string) => void
  onReject?: (id: string) => void
  onReset?: (id: string) => void
}) {
  const statusLabel = hunk.status === 'accepted' ? '已接受' : hunk.status === 'rejected' ? '已拒绝' : '待处理'
  const statusStyle = hunk.status === 'accepted'
    ? acceptedHunk
    : hunk.status === 'rejected'
      ? rejectedHunk
      : undefined
  return (
    <div style={{ ...hunkBox, ...statusStyle }}>
      <div style={hunkHeader}>
        <span>
          @@ -{hunk.oldStart} +{hunk.newStart} · {statusLabel}
        </span>
        {hunk.status === 'pending' && (
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="ghost small" onClick={() => onReject?.(hunk.id)}>拒绝</button>
            <button className="primary small" onClick={() => onAccept?.(hunk.id)}>接受</button>
          </span>
        )}
        {hunk.status !== 'pending' && (
          <button className="ghost small" onClick={() => onReset?.(hunk.id)}>撤销</button>
        )}
      </div>
      <div style={hunk.status === 'rejected' ? rejectedContent : undefined}>
        {renderChangedLines(hunk.oldText, 'removed', hunk.id)}
        {renderChangedLines(hunk.newText, 'added', hunk.id)}
      </div>
    </div>
  )
}

function renderPlainLines(text: string, keyPrefix: string) {
  return splitLines(text).map((line, i) => (
    <div key={`${keyPrefix}-${i}`} style={{ color: 'var(--text-dim)', whiteSpace: 'pre-wrap', padding: '0 6px' }}>
      {'  '}{line}
    </div>
  ))
}

function renderChangedLines(text: string, kind: 'added' | 'removed', keyPrefix: string) {
  if (!text) return null
  const bg = kind === 'added' ? 'var(--added)' : 'var(--removed)'
  const color = kind === 'added' ? 'var(--added-text)' : 'var(--removed-text)'
  const prefix = kind === 'added' ? '+ ' : '- '
  return splitLines(text).map((line, i) => (
    <div key={`${keyPrefix}-${kind}-${i}`} style={{ background: bg, color, whiteSpace: 'pre-wrap', padding: '0 6px' }}>
      {prefix}{line}
    </div>
  ))
}

function splitLines(text: string): string[] {
  const value = text.replace(/\n$/, '')
  return value ? value.split('\n') : []
}

const wrap: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 12,
  lineHeight: 1.6,
  padding: 16,
  overflow: 'auto',
}

const hunkBox: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 6,
  margin: '10px 0',
  overflow: 'hidden',
  background: 'var(--bg-panel)',
}

const hunkHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-elev)',
  color: 'var(--text-dim)',
  fontFamily: 'var(--sans)',
}

const acceptedHunk: React.CSSProperties = {
  borderColor: 'var(--added-text)',
  boxShadow: 'inset 3px 0 0 var(--added-text)',
}

const rejectedHunk: React.CSSProperties = {
  borderColor: 'var(--removed-text)',
  boxShadow: 'inset 3px 0 0 var(--removed-text)',
  opacity: 0.78,
}

const rejectedContent: React.CSSProperties = {
  textDecoration: 'line-through',
  textDecorationColor: 'var(--removed-text)',
}

const warningBox: React.CSSProperties = {
  border: '1px solid var(--danger)',
  color: 'var(--danger)',
  background: 'rgba(200, 115, 106, 0.12)',
  borderRadius: 6,
  padding: '8px 10px',
  marginBottom: 12,
  fontFamily: 'var(--sans)',
}
