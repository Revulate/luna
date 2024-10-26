import logger from './logger.js';

class MetricsHandler {
  constructor() {
    logger.startOperation('Initializing MetricsHandler');
    this.metrics = new Map();
    this.timers = new Map();
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    
    // Performance metrics
    this.responseTimeHistory = new Map();
    this.memoryUsage = new Map();
    this.cpuUsage = new Map();
    
    // Start collecting system metrics
    this.startSystemMetrics();
    logger.debug('System metrics collection started');
    
    // Add Twitch-specific metrics
    this.twitchMetrics = {
      messageRates: new Map(),
      userActivity: new Map(),
      streamStats: new Map(),
      chatStats: new Map(),
      emoteUsage: new Map(),
      cheerStats: new Map(),
      subscriptionStats: new Map()
    };
  }

  startTimer(name) {
    logger.debug(`Starting timer: ${name}`);
    this.timers.set(name, {
      start: process.hrtime.bigint(),
      name
    });
  }

  endTimer(name) {
    try {
      const timer = this.timers.get(name);
      if (!timer) {
        logger.warn(`No timer found with name: ${name}`);
        return null;
      }

      const end = process.hrtime.bigint();
      const duration = Number(end - timer.start) / 1e6;
      
      this.recordMetric(`${name}_duration`, duration);
      this.timers.delete(name);
      
      logger.debug(`Timer ${name} ended`, { duration: `${duration}ms` });
      return duration;
    } catch (error) {
      logger.error('Error ending timer:', { error, name });
      return null;
    }
  }

  incrementCounter(name, value = 1) {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
    this.recordMetric(name, current + value);
  }

  setGauge(name, value) {
    this.gauges.set(name, value);
    this.recordMetric(name, value);
  }

  recordHistogram(name, value) {
    const histogram = this.histograms.get(name) || {
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
      values: []
    };

    histogram.count++;
    histogram.sum += value;
    histogram.min = Math.min(histogram.min, value);
    histogram.max = Math.max(histogram.max, value);
    histogram.values.push(value);

    // Keep only recent values
    if (histogram.values.length > 1000) {
      histogram.values = histogram.values.slice(-1000);
    }

    this.histograms.set(name, histogram);
    this.recordMetric(name, value);
  }

  recordMetric(name, value, tags = {}) {
    const metric = {
      value,
      timestamp: Date.now(),
      tags
    };

    const history = this.metrics.get(name) || [];
    history.push(metric);

    // Keep only recent metrics
    while (history.length > 1000) {
      history.shift();
    }

    this.metrics.set(name, history);
  }

  getMetric(name) {
    return this.metrics.get(name) || [];
  }

  getMetricAverage(name, timeWindow = 300000) { // Default 5 minutes
    const metrics = this.getMetric(name);
    const now = Date.now();
    const recentMetrics = metrics.filter(m => now - m.timestamp < timeWindow);
    
    if (recentMetrics.length === 0) return null;
    
    const sum = recentMetrics.reduce((acc, m) => acc + m.value, 0);
    return sum / recentMetrics.length;
  }

  startSystemMetrics() {
    setInterval(() => {
      // Memory metrics
      const memUsage = process.memoryUsage();
      this.setGauge('memory_heap_used', memUsage.heapUsed);
      this.setGauge('memory_heap_total', memUsage.heapTotal);
      this.setGauge('memory_rss', memUsage.rss);
      
      // CPU metrics
      const cpuUsage = process.cpuUsage();
      this.setGauge('cpu_user', cpuUsage.user);
      this.setGauge('cpu_system', cpuUsage.system);
      
      // Event loop lag
      this.measureEventLoopLag();
    }, 5000); // Every 5 seconds
  }

  measureEventLoopLag() {
    const start = Date.now();
    setImmediate(() => {
      const lag = Date.now() - start;
      this.recordHistogram('event_loop_lag', lag);
    });
  }

  getPerformanceMetrics() {
    return {
      memory: {
        heap: this.getMetricAverage('memory_heap_used'),
        rss: this.getMetricAverage('memory_rss')
      },
      cpu: {
        user: this.getMetricAverage('cpu_user'),
        system: this.getMetricAverage('cpu_system')
      },
      eventLoop: {
        lag: this.getMetricAverage('event_loop_lag')
      },
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges)
    };
  }

  getHistogramStats(name) {
    const histogram = this.histograms.get(name);
    if (!histogram) return null;

    const values = histogram.values.slice().sort((a, b) => a - b);
    const p50 = values[Math.floor(values.length * 0.5)];
    const p90 = values[Math.floor(values.length * 0.9)];
    const p99 = values[Math.floor(values.length * 0.99)];

    return {
      count: histogram.count,
      min: histogram.min,
      max: histogram.max,
      avg: histogram.sum / histogram.count,
      p50,
      p90,
      p99
    };
  }

  reset() {
    this.metrics.clear();
    this.timers.clear();
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  trackChatMetrics(channel, message, metadata = {}) {
    const now = Date.now();
    const metrics = this.chatMetrics;

    // Track message rate
    const rate = metrics.messageRate.get(channel) || [];
    rate.push(now);
    // Keep last minute of data
    while (rate.length > 0 && now - rate[0] > 60000) rate.shift();
    metrics.messageRate.set(channel, rate);

    // Track command usage if applicable
    if (metadata.command) {
      const commands = metrics.commandUsage.get(channel) || new Map();
      commands.set(metadata.command, (commands.get(metadata.command) || 0) + 1);
      metrics.commandUsage.set(channel, commands);
    }

    // Track emote usage
    if (metadata.emotes) {
      const emotes = metrics.emoteUsage.get(channel) || new Map();
      metadata.emotes.forEach(emote => {
        emotes.set(emote, (emotes.get(emote) || 0) + 1);
      });
      metrics.emoteUsage.set(channel, emotes);
    }
  }

  trackTwitchMetrics(channel, data) {
    const stats = this.twitchMetrics.chatStats.get(channel) || {
      messages: 0,
      commands: 0,
      emotes: 0,
      bits: 0,
      subscriptions: 0,
      timeouts: 0,
      bans: 0
    };

    // Update stats based on message type
    if (data.isCheer) {
      stats.bits += data.bits;
      this.trackCheerMetrics(channel, data);
    }
    if (data.isCommand) {
      stats.commands++;
    }
    if (data.emotes?.length) {
      stats.emotes += data.emotes.length;
      this.trackEmoteUsage(channel, data.emotes);
    }
    if (data.isTimeout) {
      stats.timeouts++;
    }
    if (data.isBan) {
      stats.bans++;
    }

    stats.messages++;
    this.twitchMetrics.chatStats.set(channel, stats);
  }

  trackCheerMetrics(channel, data) {
    const cheerStats = this.twitchMetrics.cheerStats.get(channel) || {
      totalBits: 0,
      cheerCount: 0,
      topCheerers: new Map()
    };

    cheerStats.totalBits += data.bits;
    cheerStats.cheerCount++;
    
    // Track top cheerers
    const userBits = cheerStats.topCheerers.get(data.userId) || 0;
    cheerStats.topCheerers.set(data.userId, userBits + data.bits);

    this.twitchMetrics.cheerStats.set(channel, cheerStats);
  }

  trackEmoteUsage(channel, emotes) {
    const emoteStats = this.twitchMetrics.emoteUsage.get(channel) || new Map();
    
    emotes.forEach(emote => {
      const count = emoteStats.get(emote) || 0;
      emoteStats.set(emote, count + 1);
    });

    this.twitchMetrics.emoteUsage.set(channel, emoteStats);
  }
}

export function setupMetrics() {
  return new MetricsHandler();
}
