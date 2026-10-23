import {
  Paperclip,
  Square,
  SquareCheck,
  Image as ImageIcon,
  Unlink,
} from 'lucide-react'
import { memo, type ReactNode } from 'react'
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { refIdOf, remarkRefs } from '@shared/refs'
import { t } from '../i18n'
import {
  ATTACHMENT,
  attachmentUrl,
  hasMarkdown,
  type Mention,
} from './mentions'

/** Los esquemas propios (`attachment:`, `item:`) pasan; el resto sigue la lista segura de `react-markdown`. */
const urlTransform = (url: string) =>
  /^(?:attachment|item):/.test(url) ? url : defaultUrlTransform(url)

type Mode = 'row' | 'full'

type Props = {
  text: string
  orgId: string
  mentions: Mention[]
  /** `row`: en una fila (todo inerte, cabe dentro de un botón). `full`: en el detalle (links y chips activos). */
  mode: Mode
  onOpenItem?: (mention: Mention) => void
}

/** El chip de una referencia: título del item con su estado (ícono + tachado, nunca solo color). */
function RefChip({
  mention,
  onOpen,
}: {
  mention: Mention | undefined
  onOpen?: (mention: Mention) => void
}) {
  if (!mention)
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-control px-1.5 text-meta text-muted italic">
        <Unlink aria-hidden size={12} className="shrink-0" />
        {t('md.missing')}
      </span>
    )
  const Icon = mention.done ? SquareCheck : Square
  const label = mention.title || t('md.untitled')
  const body = (
    <>
      <Icon aria-hidden size={12} className="shrink-0" />
      <span className={`truncate ${mention.done ? 'line-through' : ''}`}>
        {label}
      </span>
    </>
  )
  const base =
    'inline-flex max-w-full items-center gap-1 rounded-control bg-text/8 px-1.5 align-baseline text-meta text-text'
  if (!onOpen) return <span className={base}>{body}</span>
  return (
    <button
      type="button"
      onClick={() => onOpen(mention)}
      aria-label={t('md.openRef', { title: label, list: mention.listName })}
      className={`${base} transition-colors duration-(--dur-fast) hover:bg-text/12`}
    >
      {body}
    </button>
  )
}

const block =
  (className = '') =>
  ({ children }: { children?: ReactNode }) => (
    <span className={`block ${className}`}>{children}</span>
  )

/** Casilla de una lista de tareas de Markdown: solo se muestra, el estado se cambia en el texto. */
function TaskBox({ checked }: { checked?: boolean }) {
  const Icon = checked ? SquareCheck : Square
  return (
    <>
      <Icon aria-hidden size={14} className="mr-1 inline align-text-bottom" />
      <span className="sr-only">
        {checked ? t('md.taskDone') : t('md.taskOpen')}
      </span>
    </>
  )
}

function components({ orgId, mentions, mode, onOpenItem }: Props): Components {
  const byId = new Map(mentions.map((m) => [m.id, m]))
  const open = mode === 'full' ? onOpenItem : undefined
  const code = ({ children }: { children?: ReactNode }) => (
    <code className="rounded-control bg-text/8 px-1 font-mono text-meta">
      {children}
    </code>
  )

  if (mode === 'row')
    return {
      p: block(),
      h1: block('font-semibold'),
      h2: block('font-semibold'),
      h3: block('font-semibold'),
      h4: block('font-semibold'),
      h5: block('font-semibold'),
      h6: block('font-semibold'),
      blockquote: block('border-l-2 border-border pl-2 text-muted'),
      ul: block(),
      ol: block(),
      li: ({ children }) => (
        <span className="block">
          <span aria-hidden>• </span>
          {children}
        </span>
      ),
      pre: block('whitespace-pre-wrap font-mono text-meta'),
      code,
      input: ({ checked }) => <TaskBox checked={checked} />,
      a: ({ href = '', children }) => {
        const ref = refIdOf(href)
        if (ref) return <RefChip mention={byId.get(ref)} />
        return <span className="underline underline-offset-2">{children}</span>
      },
      img: ({ alt }) => (
        <span className="inline-flex items-center gap-1 text-meta text-muted">
          <ImageIcon aria-hidden size={12} />
          {alt || t('md.image')}
        </span>
      ),
    }

  return {
    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
    // Los títulos del item van un nivel bajo los del Dock (h3): siempre h4, así el esquema de la página no se rompe.
    h1: ({ children }) => (
      <h4 className="mb-1 text-body-lg font-semibold">{children}</h4>
    ),
    h2: ({ children }) => (
      <h4 className="mb-1 text-body-lg font-semibold">{children}</h4>
    ),
    h3: ({ children }) => (
      <h4 className="mb-1 text-body font-semibold">{children}</h4>
    ),
    h4: ({ children }) => (
      <h4 className="mb-1 text-body font-semibold">{children}</h4>
    ),
    h5: ({ children }) => (
      <h4 className="mb-1 text-body font-semibold">{children}</h4>
    ),
    h6: ({ children }) => (
      <h4 className="mb-1 text-body font-semibold">{children}</h4>
    ),
    blockquote: ({ children }) => (
      <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted">
        {children}
      </blockquote>
    ),
    ul: ({ children, className }) => (
      <ul
        className={`mb-2 pl-5 ${className?.includes('contains-task-list') ? 'list-none pl-0' : 'list-disc'}`}
      >
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-2 list-decimal pl-5">{children}</ol>
    ),
    li: ({ children }) => <li className="my-0.5">{children}</li>,
    hr: () => <hr className="my-3 border-border" />,
    pre: ({ children }) => (
      <pre className="mb-2 overflow-x-auto rounded-control bg-surface-2 p-2 font-mono text-meta">
        {children}
      </pre>
    ),
    code,
    table: ({ children }) => (
      <div className="mb-2 overflow-x-auto">
        <table className="w-full border-collapse text-body">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-border px-2 py-1 text-left font-semibold">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-border px-2 py-1">{children}</td>
    ),
    input: ({ checked }) => <TaskBox checked={checked} />,
    a: ({ href = '', children }) => {
      const ref = refIdOf(href)
      if (ref) return <RefChip mention={byId.get(ref)} onOpen={open} />
      const file = ATTACHMENT.exec(href)
      if (file)
        return (
          <a
            href={attachmentUrl(orgId, file[1]!)}
            download
            className="inline-flex items-center gap-1 text-text underline decoration-accent decoration-2 underline-offset-2"
          >
            <Paperclip aria-hidden size={14} />
            {children}
          </a>
        )
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-text underline decoration-accent decoration-2 underline-offset-2"
        >
          {children}
          <span className="sr-only"> {t('md.external')}</span>
        </a>
      )
    },
    img: ({ src, alt }) => {
      const file = typeof src === 'string' ? ATTACHMENT.exec(src) : null
      // Solo se cargan imágenes adjuntas: una imagen de otro sitio avisaría a ese sitio cada vez que alguien abre el item.
      if (!file)
        return (
          <span className="inline-flex items-center gap-1 text-meta text-muted">
            <ImageIcon aria-hidden size={12} />
            {t('md.externalImage', { alt: alt || '' })}
          </span>
        )
      const url = attachmentUrl(orgId, file[1]!)
      return (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img
            src={url}
            alt={alt || t('md.imageAlt')}
            loading="lazy"
            className="max-h-80 max-w-full rounded-control border border-border"
          />
          <span className="sr-only"> {t('md.external')}</span>
        </a>
      )
    },
  }
}

/** En una fila solo cabe lo que es válido dentro de un botón; el resto (tablas, reglas) se aplana a su texto. */
const ROW_ELEMENTS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'ol',
  'li',
  'pre',
  'code',
  'strong',
  'em',
  'del',
  'a',
  'br',
  'img',
  'input',
]

const same = (a: Mention[], b: Mention[]) =>
  a === b ||
  (a.length === b.length &&
    a.every(
      (m, i) =>
        m.id === b[i]!.id &&
        m.title === b[i]!.title &&
        m.done === b[i]!.done &&
        m.listName === b[i]!.listName &&
        m.listId === b[i]!.listId,
    ))

/**
 * Markdown de un item. El texto del servidor sigue siendo la fuente de verdad: acá solo se dibuja. HTML crudo no se
 * interpreta (se muestra como texto), las imágenes son solo adjuntos y `[[id]]` se dibuja como chip con el título vivo
 * del item (`shared/refs.ts` decide qué es una referencia, igual que el servidor).
 */
export const Markdown = memo(
  function Markdown(props: Props) {
    const { text, mode } = props
    if (!hasMarkdown(text))
      return (
        <span className="block break-words whitespace-pre-wrap">{text}</span>
      )
    const Wrap = mode === 'row' ? 'span' : 'div'
    return (
      <Wrap className="block min-w-0 break-words">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkRefs]}
          urlTransform={urlTransform}
          allowedElements={mode === 'row' ? ROW_ELEMENTS : undefined}
          unwrapDisallowed={mode === 'row'}
          components={components(props)}
        >
          {text}
        </ReactMarkdown>
      </Wrap>
    )
  },
  (a, b) =>
    a.text === b.text &&
    a.mode === b.mode &&
    a.orgId === b.orgId &&
    a.onOpenItem === b.onOpenItem &&
    same(a.mentions, b.mentions),
)
