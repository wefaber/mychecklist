import SchemaBuilder from '@pothos/core'

export type Context = Record<string, never>

/** Code-first schema. M0 only reports the version; the domain types arrive with M1+. */
export function buildSchema() {
  const builder = new SchemaBuilder<{ Context: Context }>({})

  builder.queryType({
    fields: (t) => ({
      version: t.string({ resolve: () => process.env.APP_VERSION ?? 'dev' }),
    }),
  })

  return builder.toSchema()
}
