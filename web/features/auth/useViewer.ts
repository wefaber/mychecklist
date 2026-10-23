import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { gql } from '../../lib/graphql'
import { apiUrl } from '../../lib/server'

export type Viewer = {
  login: string
  name: string | null
  avatarUrl: string | null
}

type MeResult = { loginAvailable: boolean; me: Viewer | null }

const ME = '{ loginAvailable me { login name avatarUrl } }'

/** Quién está mirando: la sesión de la cookie, y si este servidor puede iniciar sesión. */
export function useViewer() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['me'], queryFn: () => gql<MeResult>(ME) })
  const signOut = useMutation({
    mutationFn: async () => {
      await fetch(apiUrl('/auth/logout'), {
        method: 'POST',
        credentials: 'include',
      })
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['me'] }),
  })
  return {
    loading: query.isPending,
    failed: query.isError,
    viewer: query.data?.me ?? null,
    loginAvailable: query.data?.loginAvailable ?? false,
    signOut: () => signOut.mutate(),
    signingOut: signOut.isPending,
  }
}

/** El login es una redirección completa a GitHub; vuelve a `return` con la cookie puesta. */
export function startLogin() {
  const back = location.pathname + location.search
  location.assign(
    apiUrl(`/auth/github/login?return=${encodeURIComponent(back)}`),
  )
}
