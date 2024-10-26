import logger from './logger.js';

class TaskScheduler {
  constructor() {
    logger.startOperation('Initializing TaskScheduler');
    this.tasks = new Map();
    this.intervals = new Map();
    this.schedules = new Map();
    this.retryQueues = new Map();
    
    // Task status tracking
    this.taskHistory = new Map();
    this.runningTasks = new Set();
    
    // Start the scheduler
    this.start();
    logger.debug('Task scheduler started');
  }

  scheduleTask(name, task, options = {}) {
    try {
      logger.debug(`Scheduling task: ${name}`, options);
      
      const taskConfig = {
        name,
        task,
        interval: options.interval,
        schedule: options.schedule,
        retryLimit: options.retryLimit || 3,
        retryDelay: options.retryDelay || 1000,
        timeout: options.timeout,
        priority: options.priority || 0,
        lastRun: null,
        nextRun: this.calculateNextRun(options),
        status: 'scheduled'
      };

      this.tasks.set(name, taskConfig);
      logger.debug(`Task scheduled successfully: ${name}`);
      
      return true;
    } catch (error) {
      logger.error(`Error scheduling task ${name}:`, error);
      return false;
    }
  }

  async executeTask(name) {
    const taskConfig = this.tasks.get(name);
    if (!taskConfig) {
      logger.error(`Task not found: ${name}`);
      return false;
    }

    if (this.runningTasks.has(name)) {
      logger.warn(`Task ${name} is already running`);
      return false;
    }

    try {
      this.runningTasks.add(name);
      taskConfig.status = 'running';
      taskConfig.lastRun = Date.now();

      // Execute with timeout if specified
      const result = await this.executeWithTimeout(taskConfig);
      
      this.updateTaskHistory(name, 'success', result);
      taskConfig.status = 'completed';
      taskConfig.nextRun = this.calculateNextRun(taskConfig);
      
      return true;
    } catch (error) {
      logger.error(`Error executing task ${name}:`, error);
      
      this.updateTaskHistory(name, 'error', error);
      taskConfig.status = 'failed';
      
      // Handle retry logic
      if (this.shouldRetryTask(taskConfig)) {
        this.scheduleRetry(taskConfig);
      }
      
      return false;
    } finally {
      this.runningTasks.delete(name);
    }
  }

  async executeWithTimeout(taskConfig) {
    if (!taskConfig.timeout) {
      return await taskConfig.task();
    }

    return Promise.race([
      taskConfig.task(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Task ${taskConfig.name} timed out after ${taskConfig.timeout}ms`));
        }, taskConfig.timeout);
      })
    ]);
  }

  calculateNextRun(options) {
    if (options.interval) {
      return Date.now() + options.interval;
    }
    if (options.schedule) {
      // Parse cron-like schedule string
      return this.parseSchedule(options.schedule);
    }
    return null;
  }

  parseSchedule(schedule) {
    // Simple schedule parser for demonstration
    // In production, use a proper cron parser library
    const now = new Date();
    const [hours, minutes] = schedule.split(':').map(Number);
    
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    
    return next.getTime();
  }

  shouldRetryTask(taskConfig) {
    const retries = this.retryQueues.get(taskConfig.name)?.length || 0;
    return retries < taskConfig.retryLimit;
  }

  scheduleRetry(taskConfig) {
    const retries = this.retryQueues.get(taskConfig.name)?.length || 0;
    const delay = taskConfig.retryDelay * Math.pow(2, retries); // Exponential backoff
    
    const retryQueue = this.retryQueues.get(taskConfig.name) || [];
    retryQueue.push({
      time: Date.now() + delay,
      attempt: retries + 1
    });
    
    this.retryQueues.set(taskConfig.name, retryQueue);
  }

  updateTaskHistory(name, status, result) {
    const history = this.taskHistory.get(name) || [];
    history.push({
      timestamp: Date.now(),
      status,
      result
    });

    // Keep only recent history
    while (history.length > 100) {
      history.shift();
    }

    this.taskHistory.set(name, history);
  }

  start() {
    // Main scheduler loop
    setInterval(() => {
      const now = Date.now();
      
      // Check scheduled tasks
      for (const [name, task] of this.tasks.entries()) {
        if (task.nextRun && task.nextRun <= now) {
          this.executeTask(name);
        }
      }
      
      // Check retry queues
      for (const [name, retryQueue] of this.retryQueues.entries()) {
        while (retryQueue.length > 0 && retryQueue[0].time <= now) {
          retryQueue.shift();
          this.executeTask(name);
        }
      }
    }, 1000); // Check every second
  }

  getTaskStatus(name) {
    const task = this.tasks.get(name);
    if (!task) return null;

    return {
      name: task.name,
      status: task.status,
      lastRun: task.lastRun,
      nextRun: task.nextRun,
      history: this.taskHistory.get(name) || []
    };
  }

  getAllTaskStatuses() {
    return Array.from(this.tasks.keys()).map(name => this.getTaskStatus(name));
  }

  cancelTask(name) {
    this.tasks.delete(name);
    this.retryQueues.delete(name);
    return true;
  }
}

export function setupScheduler() {
  return new TaskScheduler();
}
