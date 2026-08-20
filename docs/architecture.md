# Architecture Overview

This document outlines the high-level architecture of the Job Scheduler.

## System Components

The system is decoupled into three primary components to allow independent scaling, improved fault tolerance, and a clear separation of concerns.

1.  **API Server (REST Interface)**
    *   Handles incoming requests from clients (creating queues, scheduling jobs, monitoring metrics).
    *   Saves job definitions into the database.
    *   Validates authorization and manages projects/organizations.
    *   *Does not execute jobs.*

2.  **Worker Process(es)**
    *   Continuously polls the database for eligible jobs (`status='QUEUED'` and `runAt <= now`).
    *   Atomically claims jobs using transactional locks to prevent double-execution.
    *   Executes the job payload against a pluggable handler.
    *   Records metrics, manages retries, and tracks executions.
    *   Can be scaled horizontally.

3.  **Database (PostgreSQL / SQLite)**
    *   The single source of truth for all state.
    *   Acts as the persistent queue using transactional locks.

## Architecture Diagram

```mermaid
flowchart TD
    %% Define styles
    classDef client fill:#3498db,stroke:#2980b9,stroke-width:2px,color:#fff
    classDef api fill:#2ecc71,stroke:#27ae60,stroke-width:2px,color:#fff
    classDef db fill:#f39c12,stroke:#d35400,stroke-width:2px,color:#fff
    classDef worker fill:#9b59b6,stroke:#8e44ad,stroke-width:2px,color:#fff

    Client1[Frontend Dashboard]:::client
    Client2[External Services]:::client

    subgraph "Web Node"
        API[API Server (Express)]:::api
    end

    subgraph "Persistence Layer"
        DB[(Database: PostgreSQL/SQLite)]:::db
    end

    subgraph "Worker Nodes (Scalable)"
        Worker1[Worker 1]:::worker
        Worker2[Worker 2]:::worker
        WorkerN[Worker N]:::worker
    end

    %% Client Interactions
    Client1 -->|REST API Calls\n(Jobs, Metrics)| API
    Client2 -->|REST API Calls\n(Schedule Jobs)| API

    %% API Server to DB
    API -->|INSERT Jobs\n(status=QUEUED)| DB
    
    %% Workers to DB
    Worker1 <-->|1. Poll / Claim (FOR UPDATE SKIP LOCKED)\n2. Update (RUNNING, COMPLETED)| DB
    Worker2 <-->|1. Poll / Claim\n2. Update Status| DB
    WorkerN <-->|1. Poll / Claim\n2. Update Status| DB

    %% Note for decoupling
    style API stroke-dasharray: 5 5
```

## Why Separate the API and Worker?

The API server and Worker are built as entirely separate processes (though they share a database and ORM schema). 

*   **Independent Scaling**: If API traffic spikes (e.g., massive influx of job creations), the API layer can be horizontally scaled without taking CPU away from job execution. Conversely, if execution is CPU-intensive, workers can be scaled out aggressively without slowing down HTTP responses.
*   **Fault Isolation**: If a worker crashes due to a bad job payload, it only takes down that specific worker instance. The API server remains online, continuing to accept new jobs.
*   **Predictable Performance**: Job execution is inherently asynchronous. By offloading execution to polling workers, the API server's response times stay consistently fast.
