import { apiClient } from './client';

export const authService = {
  login: async (email: string, password: string) => {
    const response = await apiClient.post('/auth/login', { email, password });
    return response.data;
  },
  signup: async (email: string, password: string, name: string) => {
    const response = await apiClient.post('/auth/signup', { email, password, name });
    return response.data;
  },
  getMe: async () => {
    const response = await apiClient.get('/auth/me');
    return response.data;
  }
};

export const orgService = {
  list: async () => {
    const response = await apiClient.get('/orgs');
    return response.data;
  }
};

export const projectService = {
  list: async (orgId: string) => {
    const response = await apiClient.get(`/orgs/${orgId}/projects`);
    return response.data;
  },
  create: async (orgId: string, name: string) => {
    const response = await apiClient.post(`/orgs/${orgId}/projects`, { name });
    return response.data;
  },
  delete: async (projectId: string) => {
    const response = await apiClient.delete(`/projects/${projectId}`);
    return response.data;
  }
};

export const queueService = {
  list: async (projectId: string) => {
    const response = await apiClient.get(`/projects/${projectId}/queues`);
    return response.data;
  },
  create: async (projectId: string, name: string, priority = 0, concurrencyLimit = 10) => {
    const response = await apiClient.post(`/projects/${projectId}/queues`, {
      name,
      priority,
      concurrencyLimit,
      retryPolicy: { strategy: 'FIXED', baseDelayMs: 1000, maxRetries: 3 }
    });
    return response.data;
  },
  get: async (queueId: string) => {
    const response = await apiClient.get(`/queues/${queueId}`);
    return response.data;
  },
  getMetrics: async (queueId: string) => {
    const response = await apiClient.get(`/queues/${queueId}/metrics`);
    return response.data;
  },
  pause: async (queueId: string) => {
    const response = await apiClient.post(`/queues/${queueId}/pause`);
    return response.data;
  },
  resume: async (queueId: string) => {
    const response = await apiClient.post(`/queues/${queueId}/resume`);
    return response.data;
  },
  delete: async (queueId: string) => {
    const response = await apiClient.delete(`/queues/${queueId}`);
    return response.data;
  }
};

export const jobService = {
  list: async (queueId: string, params?: { page?: number; limit?: number; status?: string; type?: string }) => {
    const response = await apiClient.get(`/queues/${queueId}/jobs`, { params });
    return response.data;
  },
  get: async (jobId: string) => {
    const response = await apiClient.get(`/jobs/${jobId}`);
    return response.data;
  },
  retry: async (jobId: string) => {
    const response = await apiClient.post(`/jobs/${jobId}/retry`);
    return response.data;
  }
};

export const workerService = {
  list: async () => {
    const response = await apiClient.get('/workers');
    return response.data;
  }
};
