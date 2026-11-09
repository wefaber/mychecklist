import { useViewer } from '../auth/useViewer'
import { useMyInvitations } from './api'

/** Cuántas invitaciones esperan a la persona: solo se piden desde la tailnet. */
export function usePendingInvitations(): number {
  const { ingress } = useViewer()
  return useMyInvitations(ingress === 'tailnet').data?.length ?? 0
}

/**
 * El selector de organización (M7) solo aparece donde hay algo que elegir o crear: por el listener público no hay orgs
 * de equipo, así que ahí no se dibuja.
 */
export function useOrgChoices(): boolean {
  const { viewer, ingress } = useViewer()
  return !!viewer && (ingress === 'tailnet' || viewer.orgs.length >= 2)
}
