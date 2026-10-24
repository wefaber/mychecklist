import { useNavigate } from '@tanstack/react-router'
import { IconButton, Menu, MenuItem, MenuSeparator } from '@wefaber/ui'
import { Users } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../i18n'
import { useViewer } from '../auth/useViewer'
import { useMyInvitations } from './api'

/**
 * Selector de organización (M7). Solo aparece donde hay algo que elegir o crear: por el listener público no hay orgs
 * de equipo, así que ahí no se dibuja.
 */
export function OrgMenu() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { viewer, org, setOrg, ingress } = useViewer()
  const invitations = useMyInvitations(ingress === 'tailnet')
  const pending = invitations.data?.length ?? 0
  const orgs = viewer?.orgs ?? []
  if (!viewer || (ingress !== 'tailnet' && orgs.length < 2)) return null

  const label =
    pending > 0 ? t('orgs.menuPending', { n: pending }) : t('orgs.menu')
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label={t('orgs.menu')}
      trigger={(props) => (
        <IconButton
          label={label}
          icon={
            <span className="relative inline-flex">
              <Users size={18} />
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
      {orgs.map((o) => (
        <MenuItem
          key={o.id}
          checked={org?.id === o.id}
          keepOpen={false}
          onSelect={() => {
            setOrg(o.id)
            void navigate({ to: '/' })
          }}
        >
          {o.kind === 'personal' ? t('orgs.personal') : o.name}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem
        hint={pending > 0 ? t('orgs.pending', { n: pending }) : undefined}
        onSelect={() => void navigate({ to: '/equipo' })}
      >
        {t('orgs.manage')}
      </MenuItem>
    </Menu>
  )
}
