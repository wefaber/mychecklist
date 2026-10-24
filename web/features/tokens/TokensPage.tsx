import { Button, EmptyState, Tile } from '@wefaber/ui'
import {
  Check,
  CircleCheck,
  CircleSlash,
  Copy,
  KeyRound,
  Plus,
  Trash2,
} from 'lucide-react'
import { useId, useState } from 'react'
import { TextField } from '../../components/TextField'
import { t } from '../../i18n'
import type { MessageKey } from '../../i18n/es'
import { GraphQLRequestError } from '../../lib/graphql'
import { apiUrl } from '../../lib/server'
import { useToast } from '../../lib/toast'
import {
  tokenState,
  useApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
  type ApiToken,
  type TokenExpiry,
  type TokenMode,
} from './api'

const EXPIRIES: { value: TokenExpiry; label: MessageKey }[] = [
  { value: 'DAYS_90', label: 'tokens.expiry90' },
  { value: 'DAYS_30', label: 'tokens.expiry30' },
  { value: 'DAYS_365', label: 'tokens.expiry365' },
  { value: 'NEVER', label: 'tokens.expiryNever' },
]

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('es-UY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

const field =
  'h-8 rounded-control bg-text/8 px-2 text-body text-text focus-visible:outline-2 focus-visible:outline-accent'

/** Tokens de Code Mode de la org personal (ADR 0007): se crean, se ven una sola vez y se revocan. */
export function TokensPage({ orgId }: { orgId: string }) {
  const tokens = useApiTokens(orgId)
  const create = useCreateApiToken(orgId)
  const revoke = useRevokeApiToken(orgId)
  const show = useToast((s) => s.show)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<TokenMode>('write')
  const [expiry, setExpiry] = useState<TokenExpiry>('DAYS_90')
  // El secreto vive solo acá: al cerrar el aviso o salir de la pantalla no hay forma de recuperarlo.
  const [secret, setSecret] = useState<string | null>(null)
  const modeId = useId()
  const expiryId = useId()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = name.trim()
    if (!value) return
    try {
      const made = await create.mutateAsync({ name: value, mode, expiry })
      setSecret(made.secret)
      setName('')
    } catch (error) {
      show({
        kind: 'error',
        text:
          error instanceof GraphQLRequestError && error.code === 'LIMIT_REACHED'
            ? t('tokens.limit')
            : t('tokens.createFailed'),
      })
    }
  }

  const endpoint = new URL(apiUrl('/mcp'), location.href).href

  return (
    <div className="flex flex-col gap-4 pt-4">
      <h1 className="font-display text-h2">{t('tokens.title')}</h1>
      <p className="max-w-prose text-body text-muted">{t('tokens.intro')}</p>

      <Tile title={t('tokens.new')}>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-meta text-muted">
            {t('tokens.name')}
            <TextField
              value={name}
              maxLength={40}
              autoComplete="off"
              placeholder={t('tokens.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1">
            <label htmlFor={modeId} className="text-meta text-muted">
              {t('tokens.mode')}
            </label>
            <select
              id={modeId}
              className={field}
              value={mode}
              onChange={(e) => setMode(e.target.value as TokenMode)}
            >
              <option value="write">{t('tokens.modeWrite')}</option>
              <option value="read">{t('tokens.modeRead')}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={expiryId} className="text-meta text-muted">
              {t('tokens.expiry')}
            </label>
            <select
              id={expiryId}
              className={field}
              value={expiry}
              onChange={(e) => setExpiry(e.target.value as TokenExpiry)}
            >
              {EXPIRIES.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.label)}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="submit"
            variant="primary"
            disabled={!name.trim() || create.isPending}
          >
            <Plus aria-hidden size={14} />
            {t('tokens.create')}
          </Button>
        </form>
      </Tile>

      {secret ? (
        <SecretNotice secret={secret} onClose={() => setSecret(null)} />
      ) : null}

      <Tile title={t('tokens.yours')}>
        {tokens.isPending ? (
          <p role="status" className="text-meta text-muted">
            {t('tokens.loading')}
          </p>
        ) : tokens.isError ? (
          <p role="alert" className="text-body text-danger">
            {t('tokens.failed')}
          </p>
        ) : tokens.data.length === 0 ? (
          <EmptyState>{t('tokens.none')}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {tokens.data.map((token) => (
              <TokenRow
                key={token.id}
                token={token}
                busy={revoke.isPending}
                onRevoke={async () => {
                  try {
                    await revoke.mutateAsync(token.id)
                    show({
                      kind: 'info',
                      text: t('tokens.revoked', { name: token.name }),
                    })
                  } catch {
                    show({ kind: 'error', text: t('tokens.revokeFailed') })
                  }
                }}
              />
            ))}
          </ul>
        )}
      </Tile>

      <Tile title={t('tokens.useTitle')}>
        <dl className="grid gap-2 text-body sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">{t('tokens.useMcp')}</dt>
          <dd>
            <code className="font-mono text-meta break-all">{endpoint}</code>
          </dd>
          <dt className="text-muted">{t('tokens.useHttp')}</dt>
          <dd>
            <code className="font-mono text-meta break-all">
              POST {new URL(apiUrl('/codemode/execute'), location.href).href}
            </code>
          </dd>
          <dt className="text-muted">{t('tokens.useHeader')}</dt>
          <dd>
            <code className="font-mono text-meta">
              Authorization: Bearer &lt;token&gt;
            </code>
          </dd>
        </dl>
        <p className="mt-3 text-meta text-muted">{t('tokens.useNote')}</p>
      </Tile>
    </div>
  )
}

function SecretNotice({
  secret,
  onClose,
}: {
  secret: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
    } catch {
      // Sin permiso del portapapeles se puede seleccionar el texto a mano.
    }
  }
  return (
    <Tile title={t('tokens.secretTitle')}>
      <p role="status" className="text-body">
        {t('tokens.secretNote')}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 rounded-control bg-surface-2 px-3 py-1.5 font-mono text-meta break-all select-all">
          {secret}
        </code>
        <Button onClick={copy}>
          {copied ? (
            <Check aria-hidden size={14} />
          ) : (
            <Copy aria-hidden size={14} />
          )}
          {copied ? t('tokens.copied') : t('tokens.copy')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t('tokens.secretDone')}
        </Button>
      </div>
    </Tile>
  )
}

function TokenRow({
  token,
  busy,
  onRevoke,
}: {
  token: ApiToken
  busy: boolean
  onRevoke: () => void
}) {
  const state = tokenState(token)
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card bg-surface-2 px-3 py-2">
      <KeyRound aria-hidden size={14} className="text-muted" />
      <span className="text-body font-medium">{token.name}</span>
      <span className="font-mono text-meta text-muted">
        {t('tokens.ends', { hint: token.hint })}
      </span>
      <span className="text-meta">
        {token.mode === 'write' ? t('tokens.modeWrite') : t('tokens.modeRead')}
      </span>
      <span
        className={`inline-flex items-center gap-1 text-meta ${state === 'active' ? 'text-text' : 'text-muted'}`}
      >
        {state === 'active' ? (
          <CircleCheck aria-hidden size={14} />
        ) : (
          <CircleSlash aria-hidden size={14} />
        )}
        {t(`tokens.state.${state}`)}
      </span>
      <span className="text-meta text-muted">
        {token.expiresAt
          ? t('tokens.expiresOn', { date: date(token.expiresAt) })
          : t('tokens.neverExpires')}
        {' · '}
        {token.lastUsedAt
          ? t('tokens.lastUsed', { date: date(token.lastUsedAt) })
          : t('tokens.neverUsed')}
      </span>
      {state === 'active' ? (
        <Button
          className="ml-auto"
          disabled={busy}
          onClick={onRevoke}
          aria-label={t('tokens.revoke', { name: token.name })}
        >
          <Trash2 aria-hidden size={14} />
          {t('tokens.revokeShort')}
        </Button>
      ) : null}
    </li>
  )
}
