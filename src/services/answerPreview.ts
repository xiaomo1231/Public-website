/**
 * Live "this is how your answer will be read" previews for answer fields.
 *
 * A thin facade so UI code reaches the deterministic graders' parsers through
 * the service layer; it adds no rules of its own.
 */
export {
  parseNumeric,
  previewExpression,
  type ExpressionPreview,
} from '@/infrastructure/math/expressionEvaluator'
export { previewQuantity, type QuantityPreview } from '@/infrastructure/math/quantityAnswer'
export { previewEquation, type EquationPreview } from '@/infrastructure/chemistry/equation'
export { orderingItems, shuffledForDisplay } from '@/infrastructure/math/orderingAnswer'
