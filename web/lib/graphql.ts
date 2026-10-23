import { apiUrl } from './server'

export class GraphQLRequestError extends Error {
  readonly code: string | undefined
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'GraphQLRequestError'
    this.code = code
  }
}

type Payload<T> = {
  data?: T | null
  errors?: { message: string; extensions?: { code?: string } }[]
}

/** Una consulta o mutación contra `/graphql` con la cookie de sesión. Lanza con el `code` del primer error. */
export async function gql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(apiUrl('/graphql'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const body = (await res.json()) as Payload<T>
  const first = body.errors?.[0]
  if (first)
    throw new GraphQLRequestError(first.message, first.extensions?.code)
  if (!body.data) throw new GraphQLRequestError(`graphql ${res.status}`)
  return body.data
}
