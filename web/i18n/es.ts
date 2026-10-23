/** Textos de la UI en español rioplatense. Sin emojis ni signos de exclamación (CLAUDE.md). */
export const es = {
  'app.name': 'MyChecklist',
  'lists.title': 'Tus listas',
  'lists.empty':
    'Todavía no hay listas. Las listas y los items llegan en el próximo paso.',
  'server.connecting': 'Conectando con el servidor…',
  'server.ready': 'Servidor listo.',
  'server.down': 'No se pudo conectar con el servidor. Reintentamos solos.',
  'auth.title': 'Entrar',
  'auth.signedOut':
    'Entrá con tu cuenta de GitHub para tener tus listas en un espacio propio.',
  'auth.signIn': 'Entrar con GitHub',
  'auth.signOut': 'Salir',
  'auth.desktop':
    'El login desde la app de escritorio llega con la etapa de escritorio. Por ahora entrá desde la web.',
  'auth.denied': 'Cancelaste el acceso con GitHub. Podés volver a intentarlo.',
  'auth.error': 'No pudimos completar el login con GitHub. Probá de nuevo.',
  'auth.unavailable':
    'El login no está disponible en este servidor. Probá más tarde.',
  'auth.loading': 'Buscando tu sesión…',
  'auth.avatarOf': 'Foto de {login}',
} as const

export type MessageKey = keyof typeof es
