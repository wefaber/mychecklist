import { Link } from '@tanstack/react-router'
import { Button, Chip, EmptyState, Field, Kbd, Tile } from '@wefaber/ui'
import { ArrowLeft, LoaderCircle, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../i18n'
import type { MessageKey } from '../../i18n/es'
import {
  applyTheme,
  lightOnly,
  PALETTES,
  useTheme,
  type Mode,
  type Palette,
} from '../../lib/theme'
import type { Item, List } from '../lists/api'
import { ItemRow, type RowActions } from '../lists/ItemRow'
import { ThemeMenu } from '../theme/ThemeMenu'

type Run = { palette: Palette; mode: Mode; violations: Violation[] }
type Violation = {
  id: string
  impact: string | null
  help: string
  nodes: string[]
}

const sample = (id: string, text: string, over: Partial<Item> = {}): Item => ({
  id,
  listId: 'sample',
  parentId: null,
  position: id,
  text,
  done: false,
  doneAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
})

const lists: List[] = [
  { id: 'sample', name: 'Compras', position: 'a', open: 2, total: 3 },
  { id: 'other', name: 'Casa', position: 'b', open: 0, total: 0 },
]

const noop = () => {}
const actions: RowActions = {
  toggle: noop,
  open: noop,
  remove: noop,
  addSub: noop,
  moveTo: noop,
  step: noop,
  indent: noop,
  outdent: noop,
  keyDown: noop,
  dragStart: noop,
  dragOver: noop,
  drop: noop,
  dragEnd: noop,
}

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/**
 * Deja que el navegador pinte el tema nuevo antes de medir contraste: dos fotogramas, o 120 ms si la pestaña está
 * oculta y no hay fotogramas.
 */
const settle = () =>
  Promise.race([
    new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    ),
    new Promise<void>((r) => setTimeout(r, 120)),
  ])

/** Revisa la página con axe-core en el tema dado, con las transiciones apagadas (un fundido a medias falsea el contraste). */
async function audit(palette: Palette, mode: Mode): Promise<Run> {
  const axe = (await import('axe-core')).default
  const off = document.createElement('style')
  off.textContent =
    '*, *::before, *::after { transition: none !important; animation: none !important; }'
  document.head.append(off)
  try {
    applyTheme(palette, mode)
    await settle()
    const result = await axe.run(document, {
      runOnly: { type: 'tag', values: WCAG },
    })
    return {
      palette,
      mode,
      violations: result.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? null,
        help: v.help,
        nodes: v.nodes
          .slice(0, 3)
          .map(
            (n) =>
              `${n.target.join(' ')}${n.any[0]?.message ? ` [${n.any[0].message}]` : ''}`,
          ),
      })),
    }
  } finally {
    off.remove()
  }
}

export function Design() {
  const theme = useTheme()
  const [runs, setRuns] = useState<Run[]>([])
  const [busy, setBusy] = useState(false)

  const run = async (combos: [Palette, Mode][]) => {
    setBusy(true)
    const out: Run[] = []
    for (const [p, m] of combos) out.push(await audit(p, m))
    applyTheme(theme.palette, theme.mode)
    setRuns(out)
    setBusy(false)
  }

  // Cada paleta en los modos que tiene: Vault es solo claro.
  const modes = (p: Palette): Mode[] =>
    lightOnly(p) ? ['light'] : ['dark', 'light']
  const all: [Palette, Mode][] = PALETTES.flatMap((p) =>
    modes(p).map((m): [Palette, Mode] => [p, m]),
  )

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-bg px-4">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-body text-muted hover:text-text"
        >
          <ArrowLeft aria-hidden size={16} />
          {t('design.back')}
        </Link>
        <ThemeMenu />
      </header>
      <main
        id="main"
        className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6"
      >
        <h1 className="font-display text-h1">{t('design.title')}</h1>
        <p className="text-body-lg text-muted">{t('design.intro')}</p>

        <Tile title={t('design.samples')}>
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-0.5">
              <ItemRow
                item={sample('1', t('design.sampleItem'))}
                sub={false}
                subCount={1}
                selected={false}
                lists={lists}
                dragging={false}
                drop={null}
                actions={actions}
              />
              <ItemRow
                item={sample('2', t('design.sampleSub'), { parentId: '1' })}
                sub
                subCount={0}
                selected={false}
                lists={lists}
                dragging={false}
                drop={null}
                actions={actions}
              />
              <ItemRow
                item={sample('3', t('design.sampleDone'), { done: true })}
                sub={false}
                subCount={0}
                selected
                lists={lists}
                dragging={false}
                drop="after"
                actions={actions}
              />
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Chip selected>{t('filter.all')}</Chip>
              <Chip>{t('filter.open')}</Chip>
              <Button variant="primary">{t('list.create')}</Button>
              <Button>{t('list.cancel')}</Button>
              <Kbd keys="Mod+K" />
            </div>
            <Field
              aria-label={t('item.addLabel')}
              placeholder={t('item.addPlaceholder')}
            />
            <EmptyState>{t('design.sampleEmpty')}</EmptyState>
          </div>
        </Tile>

        <Tile title={t('design.title')}>
          <p className="mb-3 text-meta text-muted">{t('design.motion')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() => run([[theme.palette, theme.mode]])}
            >
              {busy ? (
                <LoaderCircle aria-hidden size={14} className="animate-spin" />
              ) : (
                <ScanSearch aria-hidden size={14} />
              )}
              {busy ? t('design.running') : t('design.run')}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => run(all)}>
              {t('design.runAll')}
            </Button>
          </div>
          <div
            role="status"
            id="axe-results"
            className="mt-4 flex flex-col gap-3"
          >
            {runs.map((r) => {
              const name = `${t(`theme.${r.palette}` as MessageKey)} ${t(r.mode === 'dark' ? 'theme.dark' : 'theme.light')}`
              return (
                <section
                  key={`${r.palette}-${r.mode}`}
                  data-axe={`${r.palette}-${r.mode}`}
                  data-violations={r.violations.length}
                >
                  <p
                    className={`text-body ${r.violations.length ? 'text-danger' : 'text-success'}`}
                  >
                    {r.violations.length
                      ? t('design.violations', { n: r.violations.length, name })
                      : t('design.ok', { name })}
                  </p>
                  <ul className="mt-1 flex flex-col gap-1 text-meta text-muted">
                    {r.violations.map((v) => (
                      <li key={v.id}>
                        {v.id} ({v.impact}): {v.help} — {v.nodes.join(' · ')}
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </Tile>
      </main>
    </>
  )
}
