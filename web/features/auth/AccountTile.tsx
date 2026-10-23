import { Button, EmptyState, Tile } from '@wefaber/ui'
import { LoaderCircle, LogIn, LogOut } from 'lucide-react'
import { t } from '../../i18n'
import { inTauri } from '../../lib/server'
import { startLogin, useViewer } from './useViewer'

/** Lee `?auth=denied|error` que deja el callback de OAuth al volver. */
function authNotice(): string | null {
  const reason = new URLSearchParams(location.search).get('auth')
  return reason === 'denied'
    ? t('auth.denied')
    : reason === 'error'
      ? t('auth.error')
      : null
}

export function AccountTile() {
  const { loading, failed, viewer, loginAvailable, signOut, signingOut } =
    useViewer()

  if (loading)
    return (
      <p role="status" className="flex items-center gap-2 text-meta text-muted">
        <LoaderCircle aria-hidden size={14} />
        {t('auth.loading')}
      </p>
    )

  if (viewer)
    return (
      <div className="flex items-center gap-3">
        {viewer.avatarUrl ? (
          <img
            src={viewer.avatarUrl}
            alt={t('auth.avatarOf', { login: viewer.login })}
            className="size-8 rounded-full"
          />
        ) : null}
        <span className="text-body">{viewer.name ?? viewer.login}</span>
        <Button variant="ghost" onClick={signOut} disabled={signingOut}>
          <LogOut aria-hidden size={14} />
          {t('auth.signOut')}
        </Button>
      </div>
    )

  const notice = authNotice()
  return (
    <Tile title={t('auth.title')}>
      <EmptyState>
        {inTauri()
          ? t('auth.desktop')
          : failed || !loginAvailable
            ? t('auth.unavailable')
            : t('auth.signedOut')}
      </EmptyState>
      {notice ? (
        <p role="alert" className="mt-2 text-meta text-danger">
          {notice}
        </p>
      ) : null}
      {!inTauri() && loginAvailable ? (
        <Button variant="primary" className="mt-3" onClick={startLogin}>
          <LogIn aria-hidden size={14} />
          {t('auth.signIn')}
        </Button>
      ) : null}
    </Tile>
  )
}
