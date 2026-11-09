import { t } from '../../i18n'
import { copyText, itemLink } from '../../lib/links'
import { useToast } from '../../lib/toast'
import type { Item } from './api'

/** Copia el identificador corto del item (o su id si la lista todavía no tiene código) y avisa. */
export async function copyItemId(item: Pick<Item, 'id' | 'shortId'>) {
  const value = item.shortId ?? item.id
  const ok = await copyText(value)
  useToast
    .getState()
    .show(
      ok
        ? { kind: 'info', text: t('toast.copiedId', { value }) }
        : { kind: 'error', text: t('toast.copyFailed') },
    )
}

/** Copia el link que abre el detalle del item y avisa. */
export async function copyItemLink(item: Pick<Item, 'id' | 'listId'>) {
  const ok = await copyText(itemLink(item.listId, item.id))
  useToast
    .getState()
    .show(
      ok
        ? { kind: 'info', text: t('toast.copiedLink') }
        : { kind: 'error', text: t('toast.copyFailed') },
    )
}
