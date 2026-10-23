import { TextField } from '../../components/TextField'
import { useState, type Ref } from 'react'

/**
 * Campo para agregar de a uno: Enter agrega y deja el foco para seguir escribiendo. No se deshabilita nunca; si el
 * texto está vacío, Enter no hace nada.
 */
export function Composer({
  label,
  placeholder,
  onSubmit,
  inputRef,
  density = 'comfortable',
}: {
  label: string
  placeholder: string
  onSubmit: (text: string) => Promise<unknown> | unknown
  inputRef?: Ref<HTMLInputElement>
  density?: 'compact' | 'comfortable'
}) {
  const [text, setText] = useState('')
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        const value = text.trim()
        if (!value) return
        setText('')
        await onSubmit(value)
      }}
    >
      <TextField
        ref={inputRef}
        aria-label={label}
        placeholder={placeholder}
        value={text}
        density={density}
        maxLength={4000}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
      />
    </form>
  )
}
