# Database Design Document: Job Scheduler

This document explains the design decisions, trade-offs, and strategies used to design the database schema for the distributed job scheduler.

## 1. Primary and Foreign Key Choices

- **Primary Keys (UUIDs)**: All primary keys use UUID strings (`String @id @default(uuid())`) instead of auto-incrementing integers. 
  - *Reasoning*: UUIDs are significantly better for a distributed architecture. They prevent ID collision if we scale to distributed databases, make it harder for malicious users to guess resource IDs (IDOR vulnerabilities), and allow clients to generate IDs proactively without a database roundtrip.
- **Foreign Keys**: Enforced strictly at the database level by Prisma.

## 2. Indexing Strategy

To ensure high performance for background workers continuously polling the database for jobs, we created strategic compound indexes:

- `@@index([status, queueId, runAt])` on the `Job` model.
  - *Reasoning*: Polling workers typically look for jobs that are in the `"QUEUED"` status, belong to a specific `queueId`, and where `runAt` is in the past (to support scheduled delays). This compound index perfectly matches that access pattern to ensure fast index-only scans.
- `@@index([queueId, priority])` on the `Job` model.
  - *Reasoning*: For queue inspection and fetching the highest-priority jobs first.
- `@@index([workerId, timestamp])` on `WorkerHeartbeat`.
  - *Reasoning*: Used to quickly identify dead workers (e.g., polling the latest heartbeat timestamp for all active workers).
- `@@index([jobId])` on `JobLog`.
  - *Reasoning*: To quickly fetch the audit log of a specific job.

## 3. Normalization Decisions

- **Highly Normalized Configuration**: The `RetryPolicy` is separated into its own table rather than embedding fields directly into the `Queue` or `Job`. This allows multiple queues or jobs to share the same standardized retry configuration (e.g., a global "Aggressive Retry" policy).
- **Separation of One-off vs Recurring Jobs**: `ScheduledJob` is normalized into a separate table. A `ScheduledJob` entity defines the cron schedule, and the scheduler service will read from this table to spawn individual `Job` execution records. This separates *schedule definitions* from *actual execution instances*.
- **Denormalized Payload Trade-off**: The `Job.payload` field is stored as a single `String` (containing serialized JSON) instead of relational tables. 
  - *Reasoning*: A job scheduler must be agnostic to the data it carries. Storing arbitrary JSON allows consumers to pass any data structure without requiring schema migrations. (Note: Since we are using SQLite, it is stored as `String` but treated as JSON by the application).

## 4. Cascade Behavior

The cascading rules follow standard ownership boundaries, with one extremely important exception:

- **Strict Retention of Job History (`Restrict`)**: 
  - `Queue` -> `Job` uses `onDelete: Restrict`. 
  - *Reasoning*: If an organization deletes a Queue, deleting thousands of historical Jobs silently via cascading is dangerous and destroys historical audit trails. The database will enforce that a Queue cannot be deleted if Jobs still reference it. (Alternatively, the app can soft-delete queues).
- **Worker Audit Trail (`Restrict`)**:
  - `Worker` -> `JobExecution` uses `onDelete: Restrict`. 
  - *Reasoning*: If a worker goes offline permanently and is cleaned up, we still want the `JobExecution` logs to explicitly point to the `workerId` that processed it.
- **Aggressive Cleanup (`Cascade`)**: 
  - `Organization` -> `Project`, `Project` -> `Queue` are cascaded. If an Org is deleted, its Projects and structural metadata go with it.
  - `Job` -> `JobLog` / `JobExecution` are cascaded to ensure no orphaned execution artifacts are left if a job is intentionally purged.

## 5. Performance Considerations (Trade-offs)

- **Write-Heavy Logs vs Normalization**: `JobLog` runs in a separate table. The trade-off is that it incurs more write I/O than a simple text column on the `Job` table, but it keeps the main `Job` rows much smaller, drastically improving read speeds for polling workers.
- **SQLite Enum Limitations**: Because we are using SQLite for local development, we sacrificed database-level Enum constraints and used `String` for statuses (e.g., `"QUEUED"`). This pushes the responsibility of data integrity up to the TypeScript layer, but maximizes ease of setup for local dev.
