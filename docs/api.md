# API Documentation

All API endpoints are prefixed with `/api`. Most endpoints require authentication via a JWT passed in the `Authorization: Bearer <token>` header.

List endpoints support pagination (`?page=1&limit=10`) and return a standardized response format:
```json
{
  "data": [...],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 42
  }
}
```

Errors are standardized as:
```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid payload",
    "details": [...]
  }
}
```

---

## Auth

### POST `/auth/signup`
Creates a new user account.
- **Auth Required**: No
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "secret_password",
    "name": "Test User"
  }
  ```
- **Response (201 Created)**: Returns the User object and a `token`.

### POST `/auth/login`
Authenticates an existing user.
- **Auth Required**: No
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "secret_password"
  }
  ```
- **Response (200 OK)**: Returns the User object and a `token`.

### GET `/auth/me`
Retrieves the currently authenticated user's profile.
- **Auth Required**: Yes

---

## Organizations

### GET `/orgs`
Lists organizations the user belongs to.
- **Auth Required**: Yes

### POST `/orgs`
Creates a new organization. The creator automatically becomes the `OWNER`.
- **Auth Required**: Yes
- **Request Body**: `{ "name": "My Startup" }`

---

## Projects

### GET `/orgs/:orgId/projects`
Lists projects within a specific organization.
- **Auth Required**: Yes

### POST `/orgs/:orgId/projects`
Creates a new project.
- **Auth Required**: Yes
- **Request Body**: `{ "name": "Production" }`

### GET `/projects/:projectId`
Retrieves a specific project.
- **Auth Required**: Yes

### DELETE `/projects/:projectId`
Deletes a project and all associated queues/jobs.
- **Auth Required**: Yes (Must be Org Owner)

---

## Queues

### GET `/projects/:projectId/queues`
Lists all queues in a project.
- **Auth Required**: Yes

### POST `/projects/:projectId/queues`
Creates a new queue.
- **Auth Required**: Yes
- **Request Body**: 
  ```json
  {
    "name": "Emails",
    "priority": 10,
    "concurrencyLimit": 5,
    "retryPolicy": {
      "strategy": "EXPONENTIAL",
      "baseDelayMs": 1000,
      "maxRetries": 5
    }
  }
  ```

### GET `/queues/:queueId`
Gets queue details along with live metrics (queued/running/completed/failed counts).
- **Auth Required**: Yes

### PATCH `/queues/:queueId`
Updates queue configuration (e.g. `concurrencyLimit`, `isPaused`).
- **Auth Required**: Yes

### POST `/queues/:queueId/pause` / `/resume`
Quick actions to pause or resume queue polling.
- **Auth Required**: Yes

### GET `/queues/:queueId/metrics`
Gets throughput and performance metrics for the dashboard charts.
- **Auth Required**: Yes

### DELETE `/queues/:queueId`
Deletes a queue (will be rejected if pending jobs exist to prevent data loss).
- **Auth Required**: Yes

---

## Jobs

### POST `/queues/:queueId/jobs`
Enqueues a new job (or batch of jobs). Supports idempotency via the `Idempotency-Key` header.
- **Auth Required**: Yes
- **Request Body (Immediate)**:
  ```json
  {
    "type": "email.send",
    "payload": { "to": "test@test.com" },
    "mode": "immediate"
  }
  ```
- **Request Body (Delayed)**: Includes `"mode": "delayed", "delayMs": 5000`
- **Request Body (Scheduled)**: Includes `"mode": "scheduled", "runAt": "2026-12-31T23:59:00Z"`
- **Request Body (Recurring)**: Includes `"mode": "recurring", "cronExpression": "*/5 * * * *"`
- **Request Body (Batch)**: Includes `"mode": "batch", "jobs": [{ "payload": {} }, ...]`

### GET `/queues/:queueId/jobs`
Lists jobs within a queue. 
- **Query Params**: `page`, `limit`, `status`, `type`
- **Auth Required**: Yes

### GET `/jobs/:jobId`
Retrieves full job details, including its execution history and audit logs.
- **Auth Required**: Yes

### POST `/jobs/:jobId/retry`
Manually moves a `FAILED` or `DEAD_LETTER` job back to `QUEUED`.
- **Auth Required**: Yes

### DELETE `/jobs/:jobId`
Cancels or permanently deletes a job.
- **Auth Required**: Yes
