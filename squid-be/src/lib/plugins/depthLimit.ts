import type { Plugin } from 'graphql-yoga';
import {
  GraphQLError,
  type ASTVisitor,
  type FieldNode,
  type ValidationContext,
} from 'graphql';

/**
 * Validation rule that rejects queries whose selection-set nesting exceeds
 * `maxDepth`. Guards the public gateway against deeply-nested / cyclic queries
 * that would otherwise be an easy DoS vector. No external dependency.
 */
function depthLimitRule(maxDepth: number) {
  return (context: ValidationContext): ASTVisitor => {
    return {
      Field(node: FieldNode, _key, _parent, path, ancestors) {
        // Count how many Field nodes sit above this one in the AST path.
        let depth = 0;
        for (const ancestor of ancestors) {
          if (
            ancestor &&
            !Array.isArray(ancestor) &&
            (ancestor as FieldNode).kind === 'Field'
          ) {
            depth++;
          }
        }
        if (depth >= maxDepth) {
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
