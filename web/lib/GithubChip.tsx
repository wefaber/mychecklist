import type { GithubRef } from '@shared/github'
import {
  CircleCheck,
  CircleDot,
  CircleSlash,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
} from 'lucide-react'
import { t } from '../i18n'
import type { MessageKey } from '../i18n/es'
import { useGithubLink, type GithubLink } from './github'

type Look = { Icon: LucideIcon; label: MessageKey }

/** Ícono y texto por tipo y estado: el estado nunca depende del color (DESIGN.md). */
const LOOK: Record<
  NonNullable<GithubLink['kind']>,
  Partial<Record<NonNullable<GithubLink['state']>, Look>>
> = {
  issue: {
    open: { Icon: CircleDot, label: 'gh.issue.open' },
    closed: { Icon: CircleCheck, label: 'gh.issue.closed' },
    not_planned: { Icon: CircleSlash, label: 'gh.issue.notPlanned' },
  },
  pull: {
    open: { Icon: GitPullRequest, label: 'gh.pull.open' },
    draft: { Icon: GitPullRequestDraft, label: 'gh.pull.draft' },
    merged: { Icon: GitMerge, label: 'gh.pull.merged' },
    closed: { Icon: GitPullRequestClosed, label: 'gh.pull.closed' },
  },
}

const BASE =
  'inline-flex max-w-full items-center gap-1 rounded-control bg-text/8 px-1.5 align-baseline text-meta text-text'

/**
 * Chip de un issue o PR de GitHub. Muestra `repo#n` y, si el servidor lo trajo, el título con ícono de estado. Sin dato
 * (cargando, sin acceso, sin conexión) queda como `repo#n`: el link al GitHub real funciona siempre. En una fila
 * (`row`, dentro de un botón) es inerte; en el detalle (`full`) es un link y se refresca mientras está a la vista.
 */
export function GithubChip({
  href,
  gh,
  mode,
}: {
  href: string
  gh: GithubRef
  mode: 'row' | 'full'
}) {
  const query = useGithubLink(gh, mode === 'full')
  const link = query.data
  const ok = link?.status === 'ok'
  const look =
    ok && link.kind && link.state ? LOOK[link.kind][link.state] : null
  const Icon = look?.Icon ?? ExternalLink
  const state = look
    ? t(look.label)
    : link?.status === 'not_found'
      ? t('gh.notFound')
      : link?.status === 'unavailable'
        ? t('gh.unavailable')
        : null
  const title = ok ? link.title : null

  const body = (
    <>
      <Icon aria-hidden size={12} className="shrink-0" />
      {state ? <span className="sr-only">{state}: </span> : null}
      <span className={`shrink-0 ${title ? 'font-medium' : ''}`}>
        {gh.repo}#{gh.number}
      </span>
      {title ? <span className="truncate">{title}</span> : null}
    </>
  )
  const tone = ok ? '' : ' text-muted'

  if (mode === 'row') return <span className={BASE + tone}>{body}</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title ?? undefined}
      aria-busy={query.isPending || undefined}
      className={`${BASE}${tone} no-underline transition-colors duration-(--dur-fast) hover:bg-text/12`}
    >
      {body}
      <span className="sr-only"> {t('md.external')}</span>
    </a>
  )
}
