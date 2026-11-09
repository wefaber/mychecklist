import { useNavigate } from '@tanstack/react-router'
import { IconButton, Menu, MenuItem, MenuSeparator } from '@wefaber/ui'
import {
  ArrowDownUp,
  Keyboard,
  KeyRound,
  LogOut,
  Menu as MenuIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useViewer } from '../features/auth/useViewer'
import { OrgItems } from '../features/orgs/OrgItems'
import { useOrgChoices, usePendingInvitations } from '../features/orgs/useOrgs'
import { ThemeItems } from '../features/theme/ThemeMenu'
import { t } from '../i18n'
import { useUi } from './ui'

/** Una sección del menú con su título; el título es solo visual, el grupo lleva el nombre accesible. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-0.5">
      <p aria-hidden className="px-3 pt-1 text-meta text-muted">
        {label}
      </p>
      {children}
    </div>
  )
}

/**
 * Todo lo que no es "buscar" en la barra superior, en un solo menú: cuenta, importar y exportar, tokens, atajos,
 * organización, tema y salir. Así el header queda en nombre, buscador y este botón, y no desborda en pantallas angostas.
 */
export function HeaderMenu() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { viewer, signOut, signingOut } = useViewer()
  const { setShortcuts, setTransfer } = useUi()
  const pending = usePendingInvitations()
  const hasOrgs = useOrgChoices()
  const label =
    pending > 0 ? t('menu.openPending', { n: pending }) : t('menu.open')

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label={t('menu.open')}
      className="max-h-[calc(100dvh-4.5rem)] overflow-y-auto"
      trigger={(props) => (
        <IconButton
          label={label}
          icon={
            <span className="relative inline-flex">
              <MenuIcon size={18} />
              {pending > 0 ? (
                <span
                  aria-hidden
                  className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent"
                />
              ) : null}
            </span>
          }
          {...props}
        />
      )}
    >
      {viewer ? (
        <div
          role="group"
          aria-label={t('menu.account')}
          className="flex items-center gap-2.5 px-3 py-2"
        >
          {viewer.avatarUrl ? (
            <img
              src={viewer.avatarUrl}
              alt={t('auth.avatarOf', { login: viewer.login })}
              className="size-8 shrink-0 rounded-full"
            />
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body">
              {viewer.name ?? viewer.login}
            </span>
            {viewer.name ? (
              <span className="block truncate text-meta text-muted">
                {viewer.login}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
      {viewer ? (
        <MenuItem
          icon={<ArrowDownUp size={16} />}
          onSelect={() => setTransfer(true)}
        >
          {t('transfer.title')}
        </MenuItem>
      ) : null}
      {viewer ? (
        <MenuItem
          icon={<KeyRound size={16} />}
          onSelect={() => void navigate({ to: '/ajustes/tokens' })}
        >
          {t('tokens.link')}
        </MenuItem>
      ) : null}
      <MenuItem
        icon={<Keyboard size={16} />}
        onSelect={() => setShortcuts(true)}
      >
        {t('shortcuts.open')}
      </MenuItem>
      {hasOrgs ? (
        <>
          <MenuSeparator />
          <Section label={t('orgs.menu')}>
            <OrgItems />
          </Section>
        </>
      ) : null}
      <MenuSeparator />
      <Section label={t('theme.title')}>
        <ThemeItems />
      </Section>
      {viewer ? (
        <>
          <MenuSeparator />
          <MenuItem
            icon={<LogOut size={16} />}
            onSelect={() => {
              if (!signingOut) signOut()
            }}
          >
            {t('auth.signOut')}
          </MenuItem>
        </>
      ) : null}
    </Menu>
  )
}
