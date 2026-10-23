import { Field, Textarea } from '@wefaber/ui'
import type { ComponentProps, Ref } from 'react'

type Props = ComponentProps<typeof Field> & { ref?: Ref<HTMLInputElement> }

/**
 * `Field` de @wefaber/ui con `ref`. En React 19 `ref` ya viaja como prop y `Field` lo reenvía al `<input>`, pero su tipo
 * no lo declara. Cuando el kit lo tipe, esto se reemplaza por `Field` directo.
 */
export const TextField = Field as (props: Props) => ReturnType<typeof Field>

type AreaProps = ComponentProps<typeof Textarea> & {
  ref?: Ref<HTMLTextAreaElement>
}

/** Lo mismo para `Textarea`: reenvía `ref` al `<textarea>` pero su tipo no lo declara. */
export const TextArea = Textarea as (
  props: AreaProps,
) => ReturnType<typeof Textarea>
