import { IconButton, Menu, MenuItem, MenuSeparator } from '@wefaber/ui'
import { Palette as PaletteIcon } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../i18n'
import type { MessageKey } from '../../i18n/es'
import { lightOnly, PALETTES, useTheme } from '../../lib/theme'

/** Los temas y el modo como entradas de menú. Vault es solo claro: ahí el modo queda fijo y el menú lo dice. */
export function ThemeItems() {
  const { palette, mode, setPalette, setMode } = useTheme()
  const fixed = lightOnly(palette)
  return (
    <>
      {PALETTES.map((p) => (
        <MenuItem
          key={p}
          checked={palette === p}
          keepOpen
          onSelect={() => setPalette(p)}
        >
          {t(`theme.${p}` as MessageKey)}
        </MenuItem>
      ))}
      <MenuSeparator />
      {(['dark', 'light'] as const).map((m) => (
        <MenuItem
          key={m}
          checked={(fixed ? 'light' : mode) === m}
          keepOpen
          onSelect={() => !fixed && setMode(m)}
          hint={fixed && m === 'dark' ? t('theme.lightOnly') : undefined}
        >
          {t(m === 'dark' ? 'theme.dark' : 'theme.light')}
        </MenuItem>
      ))}
    </>
  )
}

/** Tema y modo en su propio botón (el laboratorio `/design`). En la barra superior van dentro de `HeaderMenu`. */
export function ThemeMenu() {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label={t('theme.title')}
      trigger={(props) => (
        <IconButton
          label={t('theme.title')}
          icon={<PaletteIcon size={18} />}
          {...props}
        />
      )}
    >
      <ThemeItems />
    </Menu>
  )
}
