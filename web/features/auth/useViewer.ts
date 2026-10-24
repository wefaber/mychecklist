import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { gql } from '../../lib/graphql'
import { apiUrl } from '../../lib/server'
import { pickOrg, useActiveOrg } from '../orgs/active'

export type OrgRole = 'owner' | 'admin' | 'member'
export type ViewerOrg = {
  id: string
  kind: 'personal' | 'team'
  name: string
  role: OrgRole
}

export type Viewer = {
  login: string
  name: string | null
  avatarUrl: string | null
  orgs: ViewerOrg[]
}

type MeResult = {
  loginAvailable: boolean
  ingress: 'public' | 'tailnet'
  me: Viewer | null
}

const ME =
  '{ loginAvailable ingress me { login name avatarUrl orgs { id kind name role } } }'

const DEV_LOGIN_KEY = 'mychecklist.devlogin'

/** Quién está mirando: la sesión de la cookie, y si este servidor puede iniciar sesión. */
export function useViewer() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['me'], queryFn: () => gql<MeResult>(ME) })
  const activeId = useActiveOrg((s) => s.id)
  const setOrg = useActiveOrg((s) => s.set)
  const org = pickOrg(query.data?.me?.orgs ?? [], activeId)
  // Solo desarrollo (`bun run dev:desktop`): sin sesión, entra una vez con la de prueba del servidor local.
  const needsDevLogin =
    import.meta.env.VITE_DEV_LOGIN === '1' && query.data && !query.data.me
  useEffect(() => {
    if (!needsDevLogin) return
    try {
      if (sessionStorage.getItem(DEV_LOGIN_KEY)) return
      sessionStorage.setItem(DEV_LOGIN_KEY, '1')
    } catch {
      return
    }
    const back = location.pathname + location.search
    location.assign(apiUrl(`/auth/dev?return=${encodeURIComponent(back)}`))
  }, [needsDevLogin])
  const signOut = useMutation({
    mutationFn: async () => {
      await fetch(apiUrl('/auth/logout'), {
        method: 'POST',
        credentials: 'include',
      })
    },
    onSuccess: () => {
      // Los títulos de GitHub se trajeron con el token de esta persona: no quedan en memoria al salir.
      client.removeQueries({ queryKey: ['github-link'] })
      return client.invalidateQueries({ queryKey: ['me'] })
    },
  })
  return {
    loading: query.isPending,
    failed: query.isError,
    viewer: query.data?.me ?? null,
    /** La org en pantalla: la elegida si todavía pertenece a ella, si no la personal. */
    org,
    orgId: org?.id ?? null,
    setOrg,
    /** Por qué puerta se mira: las organizaciones de equipo solo existen en la `tailnet`. */
    ingress: query.data?.ingress ?? 'public',
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
