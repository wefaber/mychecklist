import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { gql } from '../../lib/graphql'

export type TokenMode = 'read' | 'write'
export type TokenExpiry = 'DAYS_30' | 'DAYS_90' | 'DAYS_365' | 'NEVER'

export type ApiToken = {
  id: string
  name: string
  mode: TokenMode
  hint: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
}

const TOKEN = 'id name mode hint createdAt lastUsedAt expiresAt revokedAt'

const key = (orgId: string) => ['api-tokens', orgId] as const

export function useApiTokens(orgId: string | null) {
  return useQuery({
    queryKey: key(orgId ?? ''),
    enabled: orgId !== null,
    queryFn: async () =>
      (
        await gql<{ org: { apiTokens: ApiToken[] } }>(
          `query($o: ID!) { org(id: $o) { apiTokens { ${TOKEN} } } }`,
          { o: orgId },
        )
      ).org.apiTokens,
  })
}

export function useCreateApiToken(orgId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      mode: TokenMode
      expiry: TokenExpiry
    }) =>
      (
        await gql<{ createApiToken: { secret: string; token: ApiToken } }>(
          `mutation($o: ID!, $n: String!, $m: TokenMode!, $e: TokenExpiry) {
            createApiToken(orgId: $o, name: $n, mode: $m, expiry: $e) { secret token { ${TOKEN} } }
          }`,
          { o: orgId, n: input.name, m: input.mode, e: input.expiry },
        )
      ).createApiToken,
    onSuccess: () => client.invalidateQueries({ queryKey: key(orgId) }),
  })
}

export function useRevokeApiToken(orgId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      gql<{ revokeApiToken: boolean }>(
        `mutation($o: ID!, $i: ID!) { revokeApiToken(orgId: $o, id: $i) }`,
        { o: orgId, i: id },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: key(orgId) }),
  })
}

export type TokenState = 'active' | 'revoked' | 'expired'

export function tokenState(token: ApiToken, now = Date.now()): TokenState {
  if (token.revokedAt) return 'revoked'
  if (token.expiresAt && Date.parse(token.expiresAt) <= now) return 'expired'
  return 'active'
}
