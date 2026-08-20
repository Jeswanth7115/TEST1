# Job Scheduler

A production-ready, transactional job scheduling system featuring a decoupled API server and polling execution workers, backed by a relational database.

## Architecture & Documentation

- [Architecture Overview](docs/architecture.md)
- [Entity-Relationship Diagram](docs/er-diagram.md)
- [REST API Reference](docs/api.md)
- [Design Decisions](docs/design-decisions.md)

## Prerequisites
- Node.js (v18 or higher)
- Optional: PostgreSQL (SQLite is used by default for local development)

## Setup Instructions

These instructions will guide you through setting up the project from a clean clone.

### 1. Database & Backend Setup

1. **Navigate to the backend directory and install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Configure Environment Variables:**
   ```bash
   copy .env.example .env
   ```
   *(Ensure `DATABASE_URL` is set to `"file:./dev.db"` if using local SQLite, or your Postgres URI.)*

3. **Initialize the Database:**
   Generate the Prisma Client and push the schema to the database.
   ```bash
   npx prisma generate
   npx prisma db push
   ```


### 2. Running the Services

The system requires **three** separate processes to be running simultaneously. Open three different terminal tabs:

**Terminal 1: Start the Backend API Server**
```bash
cd backend
npm run dev
```
*(Runs on http://localhost:3000)*

**Terminal 2: Start the Job Worker Process**
```bash
cd backend
npm run worker:start
```
*(Polls the database and executes jobs)*

**Terminal 3: Start the Frontend Dashboard**
```bash
cd frontend
npm install
npm run dev
```
*(Runs on http://localhost:5173)*

### 3. Running Tests

The backend includes a comprehensive automated test suite (Unit, Integration, and API tests) using Vitest.

```bash
cd backend
npm test
```
*(Tests run in a separate `test.db` to avoid mutating development data.)*
