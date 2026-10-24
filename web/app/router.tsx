import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
} from '@tanstack/react-router'
import { useEffect } from 'react'
import { useViewer } from '../features/auth/useViewer'
import { ListPage } from '../features/lists/ListPage'
import { TokensPage } from '../features/tokens/TokensPage'
import { CommandPalette } from '../features/palette/CommandPalette'
import { ShortcutsDialog } from '../features/palette/ShortcutsDialog'
import { TransferDialog } from '../features/transfer/TransferDialog'
import { Toaster } from '../components/Toaster'
import { AppLayout, Home } from './Shell'

function Root() {
  const { orgId } = useViewer()
  return (
    <>
      <Outlet />
      <CommandPalette orgId={orgId} />
      <ShortcutsDialog />
      <TransferDialog orgId={orgId} />
      <Toaster />
    </>
  )
}

function ListRoute() {
  const { listId } = listRoute.useParams()
  const { item } = listRoute.useSearch()
  const { orgId } = useViewer()
  useEffect(() => {
    try {
      localStorage.setItem('mychecklist.lastList', listId)
    } catch {
      // Recordar la última lista es una comodidad.
    }
  }, [listId])
  return orgId ? <ListPage orgId={orgId} listId={listId} itemId={item} /> : null
}

function TokensRoute() {
  const { orgId } = useViewer()
  return orgId ? <TokensPage orgId={orgId} /> : null
}

const rootRoute = createRootRoute({ component: Root })

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: AppLayout,
})

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: Home,
})

const listRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/l/$listId',
  validateSearch: (search: Record<string, unknown>): { item?: string } => ({
    item:
      typeof search.item === 'string' && search.item ? search.item : undefined,
  }),
  component: ListRoute,
})

const tokensRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/ajustes/tokens',
  component: TokensRoute,
})

/** Laboratorio de diseño: sin datos y sin sesión; se carga aparte para que axe-core no pese en la app. */
const designRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/design',
  component: lazyRouteComponent(
    () => import('../features/design/Design'),
    'Design',
  ),
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    appRoute.addChildren([homeRoute, listRoute, tokensRoute]),
    designRoute,
  ]),
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
