import type { Database } from 'bun:sqlite'
import type { Via } from '../db/scoped'
import type { Bus } from '../events'
import type { Ingress } from '../ingress'

/** Quién llama a un servicio y por qué puerta entró; lo arma el transporte (GraphQL, Code Mode, jobs). */
export type Caller = { userId: string; ingress: Ingress; via?: Via }

/** Lo que necesita un servicio que muta: la base y el bus por el que avisa del cambio. */
export type Deps = { db: Database; bus: Bus }
