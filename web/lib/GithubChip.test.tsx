import { describe, expect, test } from 'bun:test'
import { githubKey } from '@shared/github'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GithubLink } from './github'
import { Markdown } from './markdown'

const ISSUE = 'https://github.com/wefaber/mychecklist/issues/12'
const PULL = 'https://github.com/wefaber/mychecklist/pull/8'

const base: GithubLink = {
  owner: 'wefaber',
  repo: 'mychecklist',
  number: 12,
  status: 'ok',
  kind: 'issue',
  title: 'Abrir el detalle',
  state: 'open',
  stale: false,
  fetchedAt: null,
}

/** Dibuja el Markdown con el caché de links ya cargado, como queda después de la primera respuesta. */
function render(
  text: string,
  mode: 'row' | 'full',
  links: GithubLink[] = [],
): string {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  for (const l of links) client.setQueryData(['github-link', githubKey(l)], l)
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Markdown text={text} orgId="o" mentions={[]} mode={mode} />
    </QueryClientProvider>,
  )
}

describe('chip de GitHub', () => {
  test('una URL pegada suelta es un chip con repo, número y título', () => {
    const html = render(ISSUE, 'full', [base])
    expect(html).toContain(`href="${ISSUE}"`)
    expect(html).toContain('mychecklist#12')
    expect(html).toContain('Abrir el detalle')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  test('el estado va en texto, no solo en el ícono', () => {
    const cases: [Partial<GithubLink>, string][] = [
      [{ kind: 'issue', state: 'open' }, 'Issue abierto'],
      [{ kind: 'issue', state: 'closed' }, 'Issue cerrado'],
      [
        { kind: 'issue', state: 'not_planned' },
        'Issue cerrado como no planeado',
      ],
      [{ kind: 'pull', state: 'open' }, 'Pull request abierto'],
      [{ kind: 'pull', state: 'draft' }, 'Pull request en borrador'],
      [{ kind: 'pull', state: 'merged' }, 'Pull request mergeado'],
      [{ kind: 'pull', state: 'closed' }, 'Pull request cerrado sin mergear'],
    ]
    for (const [over, label] of cases)
      expect(render(ISSUE, 'full', [{ ...base, ...over }])).toContain(
        `<span class="sr-only">${label}: </span>`,
      )
  })

  test('sin dato (cargando) queda como link a GitHub con repo y número', () => {
    const html = render(PULL, 'full')
    expect(html).toContain(`href="${PULL}"`)
    expect(html).toContain('mychecklist#8')
    expect(html).not.toContain('Abrir el detalle')
  })

  test('no existe o sin acceso: sin título y con el motivo en texto', () => {
    const html = render(ISSUE, 'full', [
      { ...base, status: 'not_found', kind: null, title: null, state: null },
    ])
    expect(html).toContain('No existe o no tenés acceso')
    expect(html).toContain('mychecklist#12')
    expect(html).not.toContain('Abrir el detalle')
  })

  test('no disponible: sin título, con el motivo en texto', () => {
    const html = render(ISSUE, 'full', [
      { ...base, status: 'unavailable', kind: null, title: null, state: null },
    ])
    expect(html).toContain('Estado no disponible')
  })

  test('en una fila es inerte: no hay link dentro del botón', () => {
    const html = render(ISSUE, 'row', [base])
    expect(html).not.toContain('<a ')
    expect(html).toContain('Abrir el detalle')
    expect(html).toContain('mychecklist#12')
  })

  test('un link con texto propio sigue siendo un link normal', () => {
    const html = render(`[ver el issue](${ISSUE})`, 'full', [base])
    expect(html).toContain('ver el issue')
    expect(html).not.toContain('Abrir el detalle')
    expect(html).not.toContain('sr-only">Issue')
  })

  test('otros destinos de GitHub y otros sitios no son chips', () => {
    for (const url of [
      'https://github.com/wefaber/mychecklist',
      'https://github.com/wefaber/mychecklist/commit/abc123',
      'https://evil.test/wefaber/mychecklist/issues/12',
      'http://github.com/wefaber/mychecklist/issues/12',
    ]) {
      const html = render(url, 'full', [base])
      expect(html).not.toContain('Abrir el detalle')
    }
  })

  test('varios chips en un mismo texto, cada uno con su estado', () => {
    const html = render(`${ISSUE} y ${PULL}`, 'full', [
      base,
      {
        ...base,
        number: 8,
        kind: 'pull',
        state: 'merged',
        title: 'Markdown y backlinks',
      },
    ])
    expect(html).toContain('Abrir el detalle')
    expect(html).toContain('Markdown y backlinks')
    expect(html).toContain('Pull request mergeado')
  })

  test('un título con HTML se muestra como texto', () => {
    const html = render(ISSUE, 'full', [
      { ...base, title: '<img src=x onerror=alert(1)>' },
    ])
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})
