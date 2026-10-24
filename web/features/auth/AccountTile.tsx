import { Link } from '@tanstack/react-router'
import { Button, EmptyState, Tile } from '@wefaber/ui'
import { KeyRound, LoaderCircle, LogIn, LogOut } from 'lucide-react'
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
        <Link
          to="/ajustes/tokens"
          aria-label={t('tokens.link')}
          className="inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-body font-medium text-muted transition-colors duration-(--dur-fast) hover:bg-text/8 hover:text-text sm:px-3"
        >
          <KeyRound aria-hidden size={14} />
          <span className="hidden sm:inline">{t('tokens.link')}</span>
        </Link>
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
