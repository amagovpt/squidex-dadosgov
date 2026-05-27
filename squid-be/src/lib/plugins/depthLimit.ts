import type { Plugin } from 'graphql-yoga';
import {
  GraphQLError,
  Kind,
  type ASTVisitor,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
} from 'graphql';

/**
 * Computes the maximum Field-nesting depth of a selection set, resolving
 * fragment spreads and inline fragments (which are transparent and add no
 * level). `visited` guards against cyclic fragments so a malicious cyclic
 * document cannot cause infinite recursion here.
 */
function selectionSetDepth(
  selectionSet: SelectionSetNode,
  fragments: Record<string, FragmentDefinitionNode>,
  visited: Set<string>,
): number {
  let max = 0;
  for (const selection of selectionSet.selections) {
    switch (selection.kind) {
      case Kind.FIELD: {
        const childDepth = selection.selectionSet
          ? selectionSetDepth(selection.selectionSet, fragments, visited)
          : 0;
        max = Math.max(max, 1 + childDepth);
        break;
      }
      case Kind.INLINE_FRAGMENT: {
        // Inline fragments do not add a nesting level.
        max = Math.max(
          max,
          selectionSetDepth(selection.selectionSet, fragments, visited),
        );
        break;
      }
      case Kind.FRAGMENT_SPREAD: {
        const name = selection.name.value;
        if (visited.has(name)) break; // cyclic fragment — stop descending
        const fragment = fragments[name];
        if (fragment) {
          visited.add(name);
          max = Math.max(
            max,
            selectionSetDepth(fragment.selectionSet, fragments, visited),
          );
          visited.delete(name);
        }
        break;
      }
    }
  }
  return max;
}

/**
 * Validation rule that rejects queries whose Field nesting exceeds `maxDepth`,
 * counting depth across fragment spreads and inline fragments so the DoS guard
 * cannot be bypassed by hiding nesting inside fragments. No external dependency.
 */
function depthLimitRule(maxDepth: number) {
  return (context: ValidationContext): ASTVisitor => {
    const document = context.getDocument();
    const fragments: Record<string, FragmentDefinitionNode> = {};
    for (const def of document.definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION) {
        fragments[def.name.value] = def;
      }
    }

    return {
      OperationDefinition(node: OperationDefinitionNode) {
        // Skip introspection operations: they are deep by design (the standard
        // IDE introspection query nests ~12 levels), bounded, and disabled in
        // production. Counting them would break GraphiQL in development.
        const isIntrospection = node.selectionSet.selections.every(
          (sel) => sel.kind === Kind.FIELD && sel.name.value.startsWith('__'),
        );
        if (isIntrospection) return;

        const depth = selectionSetDepth(node.selectionSet, fragments, new Set());
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(
              `Query exceeds maximum allowed depth of ${maxDepth}.`,
              { nodes: [node] },
            ),
          );
        }
      },
    };
  };
}

/** graphql-yoga / envelop plugin wiring the depth-limit validation rule. */
export const useDepthLimit = (maxDepth: number): Plugin => ({
  onValidate({ addValidationRule }) {
    addValidationRule(depthLimitRule(maxDepth));
  },
});
