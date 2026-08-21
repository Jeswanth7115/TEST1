import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import orgsRoutes from './routes/orgs';
import projectsRoutes from './routes/projects';
import queuesRoutes from './routes/queues';
import jobsRoutes from './routes/jobs';
import workersRoutes from './routes/workers';
import { requestLogger, logger } from './middleware/logger';
import { errorHandler } from './middleware/errorHandler';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Log incoming requests
app.use(requestLogger);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Job Scheduler API Server is running',
    health: '/health',
    endpoints: '/api'
  });
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// API Root endpoint
app.get('/api', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Job Scheduler API v1',
    endpoints: {
      auth: '/api/auth',
      orgs: '/api/orgs',
      projects: '/api/orgs/:orgId/projects',
      queues: '/api/projects/:projectId/queues',
      jobs: '/api/queues/:queueId/jobs',
      workers: '/api/workers'
    }
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/orgs', orgsRoutes);
app.use('/api', projectsRoutes);
app.use('/api', queuesRoutes);
app.use('/api', jobsRoutes);
app.use('/api', workersRoutes);

// 404 Fallback for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'NotFound', message: `Route ${req.method} ${req.originalUrl} not found` });
});

// Global Error Handler must be the last middleware
app.use(errorHandler);

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(port, () => {
    logger.info(`Server is running on port ${port}`);
  });
}

export default app;
