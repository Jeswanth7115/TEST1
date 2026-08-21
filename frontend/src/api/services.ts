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
  adminSignup: async (email: string, password: string, name: string, adminPasskey: string) => {
    const response = await apiClient.post('/auth/admin/signup', { email, password, name, adminPasskey });
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
  update: async (queueId: string, data: { concurrencyLimit?: number; priority?: number }) => {
    const response = await apiClient.patch(`/queues/${queueId}`, data);
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
  create: async (queueId: string, data: {
    type: string;
    payload: unknown;
    mode: 'immediate' | 'delayed' | 'scheduled' | 'batch';
    delayMs?: number;
    runAt?: string;
    timezone?: string;
    jobs?: { type?: string; payload: unknown }[];
    demoMode?: boolean;
  }) => {
    const response = await apiClient.post(`/queues/${queueId}/jobs`, data);
    return response.data;
  },
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
  ,createTicket: async (jobId: string, reason: string) => {
    const response = await apiClient.post(`/jobs/${jobId}/ticket`, { reason });
    return response.data;
  },
  adminTickets: async () => {
    const response = await apiClient.get('/admin/tickets');
    return response.data;
  },
  adminDelete: async (jobId: string) => {
    await apiClient.delete(`/admin/jobs/${jobId}`);
  }
};

export const workerService = {
  list: async () => {
    const response = await apiClient.get('/workers');
    return response.data;
  },
  add: async (hostname: string) => {
    const response = await apiClient.post('/workers/nodes', { hostname });
    return response.data;
  },
  remove: async (workerId: string) => {
    const response = await apiClient.delete(`/workers/${workerId}`);
    return response.data;
  }
};
