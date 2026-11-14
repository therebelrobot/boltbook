import { useState } from 'react'
import { useCollection } from '../useCollection'
import type { Tag } from '../../shared/model'

interface TagsFieldProps {
  value: string[]
  onChange: (tags: string[]) => void
}

/**
 * Tags are typed as names, never ids. Known tags are offered as one-tap chips —
 * most-used first — so the vocabulary converges instead of sprawling.
 */
export function TagsField({ value, onChange }: TagsFieldProps) {
  const known = useCollection<Tag>('/api/tags')
  const [draft, setDraft] = useState('')

  const has = (name: string): boolean => value.some((tag) => tag.toLowerCase() === name.toLowerCase())

  const add = (name: string): void => {
    const trimmed = name.trim()
    if (trimmed === '' || has(trimmed)) return
    onChange([...value, trimmed])
    setDraft('')
  }

  const remove = (name: string): void => onChange(value.filter((tag) => tag !== name))

  const suggestions = (known.items ?? []).filter((tag) => !has(tag.name)).slice(0, 8)

  return (
    <div className="field">
      <span className="label">Tags (optional)</span>

      {value.length > 0 && (
        <div style={{ marginBottom: '0.4rem' }}>
          {value.map((tag) => (
            <button type="button" key={tag} className="chip" onClick={() => remove(tag)} aria-label={`Remove tag ${tag}`}>
              {tag} ×
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        autoCapitalize="none"
        enterKeyHint="done"
        placeholder="add a tag, then Enter"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault()
            add(draft)
          } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
            remove(value[value.length - 1]!)
          }
        }}
        onBlur={() => add(draft)}
      />

      {suggestions.length > 0 && (
        <div style={{ marginTop: '0.4rem' }}>
          {suggestions.map((tag) => (
            <button type="button" key={tag.id} className="chip" onClick={() => add(tag.name)}>
              {tag.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
