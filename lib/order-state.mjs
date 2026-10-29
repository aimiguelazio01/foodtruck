/** Allowed state changes. Inventory effects must be executed transactionally by the future order service. */
export const orderTransitions = Object.freeze({
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["collected", "cancelled"],
  collected: [],
  cancelled: [],
});
export function canTransition(from, to) {
  return Object.hasOwn(orderTransitions, from) && orderTransitions[from].includes(to);
}
