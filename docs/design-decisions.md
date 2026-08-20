# Design Decisions & Rationale

This document explains the key technical trade-offs and architecture decisions made while building the Job Scheduler.

## 1. Database Polling vs. Message Broker (Redis/RabbitMQ)
**Decision**: We used a relational database (PostgreSQL/SQLite) with a transactional polling mechanism instead of a dedicated message broker.

**Why?**
* **Simplicity & Operational Burden**: By storing jobs in the same database as our primary application (Users, Orgs, Projects), we eliminate the need to deploy, monitor, and secure an additional infrastructure component like Redis or RabbitMQ.
* **Transactional Guarantees**: We can create a Job and update an application entity in the exact same database transaction. If the transaction rolls back, the job is never scheduled. With an external broker, achieving this requires complex "outbox patterns" or distributed transactions.
* **Complex Queries**: We need to build a dashboard that paginates, filters, and searches jobs. Relational databases are built for this. Message brokers are not designed for querying historical states or filtering dead-letter queues by custom attributes.

## 2. Atomic Claiming (Preventing Double Execution)
**Decision**: How do we prevent two workers from claiming the same job at the same exact millisecond?

**In PostgreSQL**: 
We would use `SELECT ... FOR UPDATE SKIP LOCKED`. 
1. `FOR UPDATE` locks the rows so no other transaction can modify them.
2. `SKIP LOCKED` tells concurrent workers to instantly skip over rows locked by someone else, rather than waiting. This makes polling extremely fast and prevents deadlocks.

**In SQLite (Our dev environment)**:
SQLite does not support row-level locking or `SKIP LOCKED`. Instead, SQLite uses database-level write locks. When our Poller opens a `$transaction` to find and update `status = 'QUEUED'`, that entire transaction is serialized by the SQLite engine (or WAL). Concurrency is managed at the connection pool level, inherently preventing double-claims.

## 3. Idempotency Keys
**Decision**: All job creation endpoints accept an `Idempotency-Key` header.

**Why?**
Distributed systems fail unpredictably. If a client sends a `POST /jobs` request and their internet drops before receiving the `201 Created` response, they will retry the request. Without idempotency, they would accidentally schedule the job twice. By passing a unique key, our API intercepts the duplicate request, ignores the payload, and simply returns the original `200 OK` representation of the job. This is implemented via a unique database index on `idempotencyKey`.

## 4. Retry and Backoff Strategies
**Decision**: Retry policies are normalized into their own table (`RetryPolicy`) and linked to Queues/Jobs, offering `FIXED`, `LINEAR`, and `EXPONENTIAL` backoffs.

**Why?**
* **Network jitter**: External API calls fail intermittently. A fixed 1-second delay is often enough.
* **Rate Limits**: If an external API returns a `429 Too Many Requests`, hammering it every 1 second will keep you banned. An `EXPONENTIAL` backoff (1s, 2s, 4s, 8s, 16s) gives the third-party service time to recover, significantly increasing the eventual success rate.
* **Normaliztion**: By making RetryPolicies a separate table, a user can update the policy on the Queue, and all future jobs instantly inherit the new logic without needing to migrate millions of existing job rows.

## 5. What Was Deprioritized?
To ship the core engine reliably, the following were intentionally deprioritized:
1. **Webhooks / Push Notifications**: The system does not actively "push" job completion events back to the client. Clients must poll the API for job status.
2. **Job Chaining / Workflows**: We do not support DAGs (Directed Acyclic Graphs) where Job B only starts when Job A finishes.
3. **Complex Payload Schemas**: Job payloads are unstructured JSON. We rely on the worker handler to validate the payload shape at runtime (e.g., using Zod) rather than enforcing strict JSON Schemas at the database layer.

## 6. Known Limitations
* **Polling Latency**: Because workers poll every 1-2 seconds, there is an inherent 1000ms - 2000ms delay between a job being created and a worker picking it up. This is not a "real-time" sub-millisecond execution engine.
* **Database Contention (SQLite)**: While SQLite WAL mode is excellent, scaling to 10+ concurrent heavy-polling workers will result in `SQLITE_BUSY` errors. Production workloads must use PostgreSQL for true concurrent read/write throughput.
