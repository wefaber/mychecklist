import {
  GraphQLError,
  Kind,
  type ASTVisitor,
  type SelectionSetNode,
  type ValidationContext,
} from 'graphql'

/** Longest field path in an operation, following fragments. Introspection fields (`__*`) do not count. */
function depth(
  selection: SelectionSetNode,
  ctx: ValidationContext,
  visiting: Set<string>,
): number {
  let max = 0
  for (const node of selection.selections) {
    if (node.kind === Kind.FIELD) {
      if (node.name.value.startsWith('__')) continue
      max = Math.max(
        max,
        1 + (node.selectionSet ? depth(node.selectionSet, ctx, visiting) : 0),
      )
    } else if (node.kind === Kind.INLINE_FRAGMENT) {
      max = Math.max(max, depth(node.selectionSet, ctx, visiting))
    } else {
      const fragment = ctx.getFragment(node.name.value)
      if (fragment && !visiting.has(fragment.name.value)) {
        visiting.add(fragment.name.value)
        max = Math.max(max, depth(fragment.selectionSet, ctx, visiting))
        visiting.delete(fragment.name.value)
      }
    }
  }
  return max
}

/** Validation rule: reject operations nested deeper than `limit`. The public API is read-only but unauthenticated. */
export function maxDepth(limit: number) {
  return (ctx: ValidationContext): ASTVisitor => ({
    OperationDefinition(node) {
      const found = depth(node.selectionSet, ctx, new Set())
      if (found > limit) {
        ctx.reportError(
          new GraphQLError(
            `Query depth ${found} exceeds the limit of ${limit}`,
            {
              nodes: node,
              extensions: { code: 'DEPTH_LIMIT' },
            },
          ),
        )
      }
    },
  })
}
