import { useNavigate } from '@tanstack/react-router'
import { MenuItem, MenuSeparator } from '@wefaber/ui'
import { t } from '../../i18n'
import { useViewer } from '../auth/useViewer'
import { usePendingInvitations } from './useOrgs'

/** Las organizaciones de la persona y el acceso a la pantalla de equipo, como entradas de menú. */
export function OrgItems() {
  const navigate = useNavigate()
  const { viewer, org, setOrg } = useViewer()
  const pending = usePendingInvitations()
  return (
    <>
      {(viewer?.orgs ?? []).map((o) => (
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
    </>
  )
}
