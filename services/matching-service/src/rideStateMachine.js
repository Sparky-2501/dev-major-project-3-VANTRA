// The ride lifecycle as data. Every status change in the code goes through
// canTransition(), so an illegal jump (COMPLETED -> REQUESTED) is a bug that
// throws, not silent corruption.
//
//   REQUESTED -> DRIVER_ASSIGNED -> PAYMENT_AUTHORIZED -> CONFIRMED -> IN_PROGRESS -> COMPLETED
//        \              \                  \                  \
//         +--------------+------------------+------------------+--> CANCELLED  (saga compensated cleanly)
//   any non-terminal ------------------------------------------> FAILED     (compensation itself could not finish)
const TRANSITIONS = {
  REQUESTED: ['DRIVER_ASSIGNED', 'CANCELLED', 'FAILED'],
  DRIVER_ASSIGNED: ['PAYMENT_AUTHORIZED', 'CANCELLED', 'FAILED'],
  PAYMENT_AUTHORIZED: ['CONFIRMED', 'CANCELLED', 'FAILED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'FAILED'],
  IN_PROGRESS: ['COMPLETED', 'FAILED'], // once the trip started the rider cannot cancel
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
};

const STATES = Object.keys(TRANSITIONS);
const isTerminal = (s) => TRANSITIONS[s].length === 0;
const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);
// States from which a rider/saga cancel is still allowed.
const CANCELLABLE = STATES.filter((s) => canTransition(s, 'CANCELLED'));

module.exports = { TRANSITIONS, STATES, isTerminal, canTransition, CANCELLABLE };
