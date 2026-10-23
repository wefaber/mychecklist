import { Dialog, Kbd } from '@wefaber/ui'
import { useUi } from '../../app/ui'
import { t } from '../../i18n'
import type { MessageKey } from '../../i18n/es'
import { useRegistry } from '../../lib/shortcuts'

/** Ayuda de teclado (`?`): lee del mismo registro que usan la paleta y el listener, así nunca queda desactualizada. */
export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcuts } = useUi()
  const shortcuts = useRegistry((s) => s.shortcuts).filter(
    (s) => s.enabled !== false,
  )
  const groups = [...new Set(shortcuts.map((s) => s.group))]
  return (
    <Dialog
      open={shortcutsOpen}
      onClose={() => setShortcuts(false)}
      title={t('shortcuts.title')}
      closeLabel={t('toast.dismiss')}
    >
      <p className="text-meta text-muted">{t('shortcuts.help')}</p>
      {groups.map((g) => (
        <section
          key={g}
          aria-labelledby={`sc-${g}`}
          className="flex flex-col gap-1.5"
        >
          <h3 id={`sc-${g}`} className="text-body font-semibold">
            {t(g as MessageKey)}
          </h3>
          <ul className="flex flex-col gap-1">
            {shortcuts
              .filter((s) => s.group === g)
              .map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 text-body"
                >
                  <span>{t(s.label)}</span>
                  <Kbd keys={s.keys} />
                </li>
              ))}
          </ul>
        </section>
      ))}
    </Dialog>
  )
}
