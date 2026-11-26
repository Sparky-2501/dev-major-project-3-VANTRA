# Architecture decisions and trade-offs

Each section: **what we did, why, what it costs, and when the opposite is better.**
Everything here describes the code in this repository; file names are given so you can open them.

## 1. Why microservices here, and where a monolith is better

**What:** six services, each with its own database/collection and no shared models.

**Why it is defensible for this domain:** the parts have *different failure and scaling profiles*.
Driver location updates are frequent and tiny (Redis, high write rate). Matching is stateful in time
(offers, timeouts) and must be crash-safe. Payment must be isolated, idempotent and auditable.
Notification is best-effort and must never slow a booking. Splitting them lets us scale matching alone
(HPA in `k8s/23-matching-service.yaml`), kill payment in a demo without killing logins, and
explain failure handling per boundary.

**What it costs:** every call that used to be a function call is now a network call that can time out,
fail halfway or be duplicated. That is why this repo needs idempotency keys, breakers, retries, a saga and
tracing at all. Those are the *price* of the split, not a feature to be proud of by themselves.

**Where a monolith wins (say this out loud):** for a small team and an early product a single deployable
is faster to build, trivially transactional (one Mongo transaction instead of a saga), and far easier to debug.
`legacy-monolith/` is that version, after the Step 0 bug fixes. A good answer is: *"I would start as a monolith.
I split here to demonstrate distributed-systems problems, and the seams I would split first in a real company
are matching and payment."*

**Honest limit:** the services share one Mongo *server* and one Redis *server* (separate databases/keys).
Real isolation would also separate those; we accept it for a laptop/kind demo.

## 2. Orchestration vs choreography for the Saga

**What:** orchestration. `matching-service` runs the saga: `services/matching-service/src/saga/runner.js`
executes the ordered steps in `steps.js` and calls each compensation in reverse on failure.

**Why:** the booking flow has a strict order and a few failure branches. With orchestration the whole flow
is readable in one file, the state ("which step am I on, what is undone") is one document in Mongo, and
"why did this ride cancel?" is answered by reading `saga.failure` and `saga.compensationLog`.

**Choreography** (services react to each other's events, no central coordinator) has no single point of
control and couples services only through events, but the flow is spread over many files, ordering and
compensation are implicit, and debugging means reconstructing a story from event logs.

**Cost of our choice:** matching-service knows about the other steps (it is the "smart" service and
a coupling hotspot), and it must be made crash-safe, which is what the lease/resume machinery is for (section 8).

**We still use events** (Redis Streams) for *side effects* that are not part of correctness:
notifications. Rule of thumb used here: **orchestrate what must be undone, publish events for what merely needs to know.**

## 3. Why Redis GEO for matching

**What:** drivers are stored with `GEOADD drivers:available <lng> <lat> <driverId>`; matching runs
`GEOSEARCH ... BYRADIUS 3 km ASC COUNT 5 WITHDIST` and widens to 5 then 10 km only when empty
(`services/matching-service/src/geo.js`).

**Why:** "who is closest right now" over a constantly changing set is exactly what a geo index is for. A GEO set is
a sorted set (geohash score), so the query is O(log N + results) and writes are cheap. Mongo `2dsphere` would also work
but is a heavier write path for data that changes every few seconds and is worthless a minute later.

**Cost:** it is in memory (lost on Redis restart; drivers re-appear on their next ping, which is fine for live positions)
and a sorted-set member has **no per-member TTL**. We solve stale drivers two ways: a heartbeat key with a TTL plus a sweep
that `ZREM`s members whose heartbeat expired (`driver-service/src/driverState.js`, `sweepStale`), and matching also skips
anyone without a heartbeat. Also: **coordinates are always (lng, lat)**, documented in `common/keys.js`.

**Reserving a driver** is a separate concern: `SET driver:lock:<id> <rideId> NX EX ttl` (`locks.js`). NX makes
"two riders, one driver" safe because Redis executes the SET atomically.

## 4. Why a circuit breaker (and where it does not apply)

**What:** `opossum` around matching->driver, matching->payment and rider->matching
(`common/breaker.js`, clients in `matching-service/src/clients/` and `rider-service/src/matchingClient.js`).
Config: timeout 6 s, error threshold 50%, volume threshold 3, reset timeout 10 s, all env-tunable.
State is exposed at each service's `/health` and aggregated at the gateway's `/status`.

**Why:** if payment is down, every booking would wait a full timeout before failing, piling up requests and
turning one outage into many. After enough failures the breaker opens and fails calls *instantly*; after the reset
timeout one trial call goes through (HALF_OPEN), and success closes it.

**Design details worth knowing:**
* Retries are inside the breaker call and only for idempotent operations (`common/retry.js`: exponential backoff + jitter,
  never on 4xx or an open breaker). A retry outside an open breaker would defeat it.
* A declined card is HTTP 200 `{status: DECLINED}`, not an error, so business outcomes never trip a breaker.
* On open/failure the fallback returns an "unavailable" marker that becomes `DEPENDENCY_UNAVAILABLE`; the saga turns that into
  `PAYMENT_UNAVAILABLE` and compensates. Ride history uses a real degraded fallback (empty list, `degraded: true`).

**Limits:** breakers are per process, so each replica learns on its own (`/status` shows one replica). The gateway -> service hop
has **no** breaker (it returns 502 when a service is down); the spec asked for service-to-service calls and that is what is covered.

## 4b. Idempotency (the quiet hero)

Retries and duplicate clicks are only safe because every mutating path is idempotent:
* booking: unique index `(riderId, idempotencyKey)` on rides (`models/ride.model.js`); same key returns the same ride (`booking.js`);
* payment: unique index on `rideId`; authorize/capture/void/refund return the stored result (`payment-service/src/paymentService.js`);
* `void` on an unknown ride writes a VOIDED **tombstone**, so a slow authorize that lands *after* the compensation cannot create a live authorization nobody will cancel;
* driver assign/release are Lua scripts keyed by `rideId`; release by a non-owner is a no-op;
* every saga compensation is safe to run twice, and finished ones are skipped on resume.

## 5. Why an API gateway

**What:** one process type (`api-gateway`, 2 replicas) that verifies the JWT once, rate limits with Redis-backed counters,
creates/forwards `x-correlation-id`, sets `x-user-id`/`x-user-role`, strips client-supplied copies of those headers, and routes by prefix
(`src/routes.js`, `src/auth.js`, `src/app.js`).

**Why:** clients know one address; auth, rate limiting and tracing entry live in one place instead of six; services stay simple
(they trust the gateway's headers). Services also require `x-internal-key`, so a direct call that skips the gateway is rejected.

**Cost:** an extra hop of latency, and the gateway is on every request's path: it must be stateless and replicated
(it is: 2 replicas, state in Redis). Putting business logic in it would make it a distributed monolith; it only does cross-cutting concerns.
Trade-off chosen: auth fails **closed** (Redis down -> 503), rate limiting fails **open** (Redis down -> let traffic through).

## 6. Horizontal scaling and load balancing

**Rule that makes it work: no service keeps request state in process memory.**
Sessions are JWTs, the token blacklist is Redis, rate-limit counters are Redis, offers and driver locks are Redis, rides and sagas are Mongo.
So any replica can serve any request, and a replica can die without losing anything except the HTTP request it was serving.

* **Docker Compose:** nginx -> `api-gateway` (2 replicas) via Docker DNS (`nginx/nginx.conf` re-resolves the name); services find each other by name.
* **Kubernetes:** a `Service` gives a stable name and kube-proxy spreads new connections across ready pods; `readinessProbe` on `/health` takes a pod out
  of rotation when Mongo/Redis is unreachable. This is connection-level (roughly round-robin) balancing, not smart request-level balancing.
* **Matching-service specifically** is the stateful-in-time one, and still needs no sticky routing: the driver's `accept` can hit a different replica
  than the one running the saga because they communicate through Redis keys (`offers.js`). The HPA scales it 2 to 5 on CPU.

## 7. Why Redis Streams, and why no Kafka/RabbitMQ

Events here are small, low-volume and only drive notifications. Redis is already required (geo, locks, rate limit, blacklist), so an extra
broker would be extra moving parts with no benefit at this scale.
**Streams over Pub/Sub:** Pub/Sub loses messages if the subscriber is down; a Stream keeps them, and a consumer group lets several
notification replicas share the work, with `XACK` and `XAUTOCLAIM` re-delivering what a crashed replica never acknowledged
(`notification-service/src/consumer.js`).
**When Kafka would be right:** long retention/replay, many independent consumer teams, very high throughput, strict per-key ordering at scale, or
events becoming the system of record. Not here.
**Known gap:** publishing is best-effort (`common/events.js` never throws and times out after 500 ms) so a Redis blip can drop an event.
Acceptable for notifications; the fix for critical events is the **transactional outbox** (write the event to Mongo in the same operation as the state change, relay it).

## 8. Failure handling: how the saga survives a crash

The saga is a **document** in Mongo (`models/saga.model.js`): state, `completedSteps`, `context`, `failure`, `compensationLog`, timestamps, `traceparent`.
* **Lease + fencing:** an orchestrator claims a saga atomically (`mongoSagaStore.claim`), renews the lease while working, and every write is conditional on still
  owning it (`save`). A "zombie" that wakes up after its lease expired cannot overwrite the new owner.
* **Sweeper** (`saga/recovery.js`, every replica): picks up unfinished sagas with expired leases and resumes them; also creates a saga for a ride that was inserted but whose saga was never created.
* **Resume is safe** because finished steps are skipped and every step/compensation is idempotent.
* **Compensation order is a contract:** newest first, and it stops at the first failure so an earlier step is never undone while a later one is still undone.
  Stuck compensations are retried every sweep; after `MAX_COMPENSATION_ROUNDS` the saga is `COMPENSATION_FAILED` and the ride `FAILED` (human needed).
* **Failed step is compensated too**, because it may have done part of its work.

**Timeouts:** each offer waits `OFFER_TIMEOUT_SEC`; on silence/decline the driver's lock is released and the next nearest is tried, up to `MAX_OFFER_ATTEMPTS`, then the ride is cancelled `NO_DRIVERS_AVAILABLE`.
The accept/expire race is closed with a Lua script and a "revoke then read" order (`offers.js`).

## 9. Distributed tracing

OpenTelemetry in every service (`common/tracing.js`, first `require` in each `server.js`) exporting OTLP to Jaeger. Context propagates through
the gateway proxy, through `common/http.js` (injects `traceparent`), into Redis events (`events.js` stores `traceparent`, `consumer.js` continues it) and into the saga document
so a resumed saga stays in the original trace. Each saga step and compensation is a named span (`saga.step.reserveDriver`, ...).
**Known limit:** the driver's `accept` call is a separate HTTP request and therefore a separate trace; it is linked by the `ride.id` attribute, not by parent/child.

## 10. Single points of failure and what to add next

| Single point | Effect | What I would add |
|---|---|---|
| Redis (single instance) | locks, GEO, offers, rate limits, blacklist, events gone; matching and auth degrade | Redis replication + Sentinel/managed Redis; AOF persistence (compose uses AOF, K8s manifest does not) |
| MongoDB (single instance, one StatefulSet pod) | rides, sagas, payments unavailable | replica set / Atlas; backups |
| Event loss if Redis blips at publish time | missed notifications | transactional outbox |
| Gateway has no breaker to services | slow 502s when a service is down | breaker or timeouts per route |
| Breaker state per replica | replicas learn failures separately | acceptable; or a shared health signal |
| Secrets in `.env` / one K8s Secret | rotation is manual | secret manager, per-service secrets |
| No TLS inside the cluster, internal key is a shared secret | trust is network-level | mTLS (service mesh), per-service credentials |
| No lockfiles, no CI | non-reproducible builds | commit lockfiles, CI running `check-all` + unit tests + e2e |
| Matching sweeper uses polling | up to 10 s delay to resume | acceptable; or shorter interval / change streams |
| Ride-complete driver release is retry-by-caller | a failure leaves the driver reserved until the call is repeated (or locks expire) | a background retry job |
| Demo toggles | would be an attack surface in production | `DEMO_MODE=false` (the endpoints return 404) |
