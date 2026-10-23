import type { Ingress } from '../ingress'

/** Quién llama a un servicio y por qué puerta entró; lo arma el transporte (GraphQL, Code Mode, jobs). */
export type Caller = { userId: string; ingress: Ingress }
