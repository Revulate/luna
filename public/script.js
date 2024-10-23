// Add at the top of script.js
console.log('Script loaded');

function showLoading() {
  const loadingIndicator = document.getElementById('loadingIndicator');
  if (loadingIndicator) {
    loadingIndicator.style.display = 'flex';
  }
}

function hideLoading() {
  const loadingIndicator = document.getElementById('loadingIndicator');
  if (loadingIndicator) {
    loadingIndicator.style.display = 'none';
  }
}

// Update setLoading function
function setLoading(isLoading) {
  if (isLoading) {
    showLoading();
  } else {
    hideLoading();
  }
  
  const buttons = document.querySelectorAll('button');
  buttons.forEach(button => {
    button.disabled = isLoading;
    if (isLoading) {
      button.dataset.originalText = button.textContent;
      button.textContent = 'Loading...';
    } else if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
    }
  });
}

// Initialize variables at the top
let socket = null;
let memoryChart = null;
let isConnected = false;
let channelTabs = null;
let activeChannels = new Map();
let activeTab = null;

// Format uptime duration
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
}

// Update dashboard with bot status
function updateDashboard(status) {
  // Update bot status (without RSS)
  const botStatusEl = document.getElementById('botStatus');
  if (botStatusEl) {
    botStatusEl.innerHTML = `
      <div class="status-value ${status.connected ? 'connected' : 'disconnected'}">
        ${status.connected ? 'Online' : 'Offline'}
      </div>
    `;
  }

  // Update performance stats
  const storageSize = document.getElementById('storageSize');
  const messageRate = document.getElementById('messageRate');
  const heapUsage = document.getElementById('heapUsage');

  if (storageSize) storageSize.textContent = formatBytes(status.stats.dbSize);
  if (messageRate) messageRate.textContent = `${Math.round(status.stats.messageRate)}/min`;
  if (heapUsage) heapUsage.textContent = formatBytes(status.memory.heapUsed);

  // Update channel count
  const channelCountEl = document.getElementById('channelCount');
  if (channelCountEl && status.stats) {
    channelCountEl.innerHTML = `
      <div>${status.stats.channelCount} channels</div>
      <div class="additional-stats">
        Messages: ${formatNumber(status.stats.totalMessages)}<br>
        Users: ${formatNumber(status.stats.uniqueUsers)}
      </div>
    `;
  }

  // Update uptime (without storage and rate)
  const uptimeEl = document.getElementById('uptime');
  if (uptimeEl && status.startTime) {
    const uptime = Date.now() - status.startTime;
    uptimeEl.innerHTML = `<div>${formatUptime(uptime)}</div>`;
  }

  // Update memory chart
  if (status.memory?.heapUsed) {
    const memoryInMB = status.memory.heapUsed / (1024 * 1024);
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    if (window.memoryChartInstance) {
      window.memoryChartInstance.data.labels.push(timestamp);
      window.memoryChartInstance.data.datasets[0].data.push(memoryInMB.toFixed(2));

      // Keep last 10 data points
      if (window.memoryChartInstance.data.labels.length > 10) {
        window.memoryChartInstance.data.labels.shift();
        window.memoryChartInstance.data.datasets[0].data.shift();
      }

      window.memoryChartInstance.update('none');
    }
  }
}

// Add helper function for number formatting
function formatNumber(num) {
  if (num >= 1000000) return `${(num/1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num/1000).toFixed(1)}K`;
  return num.toString();
}

// Update socket initialization
function initializeSocket() {
  if (socket) {
    console.warn('Socket already initialized');
    return;
  }

  console.log('Initializing socket connection...');
  socket = io(window.location.origin, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
  });

  // Add debug logging for botStats event
  socket.on('botStats', (stats) => {
    console.log('Received bot stats:', stats);
    
    const formattedStats = {
      connected: stats.isConnected,
      startTime: stats.startTime,
      memory: {
        heapUsed: stats.memoryUsage || 0,
        heapTotal: stats.memory?.heapTotal || 0,
        rss: stats.memory?.rss || 0,
        external: stats.memory?.external || 0
      },
      stats: {
        totalMessages: stats.stats?.totalMessages || stats.messageCount || 0,
        uniqueUsers: stats.stats?.uniqueUsers || 0,
        channelCount: stats.stats?.channelCount || stats.channels?.length || 0,
        messageRate: stats.stats?.messageRate || 0,
        dbSize: stats.stats?.dbSize || 0
      }
    };

    console.log('Formatted stats:', formattedStats);
    updateDashboard(formattedStats);
  });

  // Handle connection events
  socket.on('connect', () => {
    console.log('Connected to WebSocket server');
    isConnected = true;
    updateConnectionStatus(true);
    startPeriodicUpdates(); // Start periodic updates after connection
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from WebSocket server');
    isConnected = false;
    updateConnectionStatus(false);
  });

  // Handle log updates
  socket.on('newLog', (log) => {
    addLogEntry(log);
  });

  socket.on('recentLogs', (logs) => {
    const logsBox = document.getElementById('logsBox');
    if (!logsBox) return;
    
    logsBox.innerHTML = '';
    logs.forEach(log => {
      const logEntry = document.createElement('div');
      logEntry.className = `log-entry log-${log.level}`;
      
      const timestamp = new Date(log.timestamp).toLocaleTimeString();
      logEntry.innerHTML = `
        <span class="log-timestamp">${timestamp}</span>
        <span class="log-level">[${log.level.toUpperCase()}]</span>
        <span class="log-message">${log.message}</span>
      `;
      
      logsBox.appendChild(logEntry);
    });
    logsBox.scrollTop = logsBox.scrollHeight;
  });

  // Add these new event handlers
  socket.on('channelJoined', (channel) => {
    hideLoading();
    channelTabs.addChannel(channel);
    updateChannelsList();
    // Switch to the newly joined channel
    switchToChannel(channel);
  });

  socket.on('channelLeft', (channel) => {
    hideLoading();
    channelTabs.removeChannel(channel);
    updateChannelsList();
  });

  socket.on('chatMessage', (data) => {
    console.log('Received chat message:', data); // Debug log
    addChatMessage(data.channel, data);
  });

  // Request initial bot stats
  socket.emit('requestStats');
}

// Add log handling function
function addLogEntry(log) {
  const logsBox = document.getElementById('logsBox');
  if (!logsBox) return;

  const logEntry = document.createElement('div');
  logEntry.className = `log-entry log-${log.level?.toLowerCase() || 'info'}`;
  
  const timestamp = new Date(log.timestamp || Date.now()).toLocaleTimeString();
  logEntry.innerHTML = `
    <span class="log-timestamp">${timestamp}</span>
    <span class="log-level">[${(log.level || 'INFO').toUpperCase()}]</span>
    <span class="log-message">${log.message || ''}</span>
  `;
  
  logsBox.appendChild(logEntry);
  logsBox.scrollTop = logsBox.scrollHeight;
}

// Add log filtering functionality
document.getElementById('logLevel')?.addEventListener('change', (e) => {
  const selectedLevel = e.target.value;
  const logEntries = document.querySelectorAll('.log-entry');
  
  logEntries.forEach(entry => {
    if (selectedLevel === 'all') {
      entry.style.display = '';
    } else {
      const entryLevel = entry.querySelector('.log-level').textContent.toLowerCase();
      entry.style.display = entryLevel.includes(selectedLevel) ? '' : 'none';
    }
  });
});

// Add clear logs functionality
document.getElementById('clearLogs')?.addEventListener('click', () => {
  const logsBox = document.getElementById('logsBox');
  if (logsBox) {
    logsBox.innerHTML = '';
  }
});

// Initialize everything when the page loads
let initialized = false;

document.addEventListener('DOMContentLoaded', () => {
  if (initialized) return;
  initialized = true;
  
  console.log('Initializing...');
  channelTabs = new ChannelTabs();
  initializeMemoryChart();
  initializeSocket();
  initializeTabNavigation();

  // Set up message input handling
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');

  if (messageInput && sendButton) {
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    sendButton.addEventListener('click', sendMessage);
  }
});

// Rest of your ChannelTabs class implementation...

// Add near the top of the file
class ChannelTabs {
  constructor() {
    this.activeChannel = null;
    this.channels = new Map();
  }

  initialize() {
    if (socket) {
      socket.on('channelJoined', (channel) => {
        this.addChannel(channel);
        if (!this.activeChannel) {
          this.setActiveChannel(channel);
        }
        updateChannelsList();
      });

      socket.on('channelLeft', (channel) => {
        this.removeChannel(channel);
        updateChannelsList();
      });
    }
  }

  addChannel(channel) {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, {
        messages: [],
        unread: 0
      });
      activeChannels.set(channel, { messages: [] });
    }
  }

  removeChannel(channel) {
    this.channels.delete(channel);
    activeChannels.delete(channel);
    if (this.activeChannel === channel) {
      this.activeChannel = this.channels.keys().next().value;
    }
  }

  setActiveChannel(channel) {
    this.activeChannel = channel;
    if (this.channels.has(channel)) {
      this.channels.get(channel).unread = 0;
    }
    updateChannelsList();
    loadChannelMessages(channel);
  }
}

// Add near socket event handlers
function joinChannel(channel) {
  if (!socket) return;
  socket.emit('joinChannel', channel);
  showLoading();
}

// Update the initializeMemoryChart function
function initializeMemoryChart() {
  const ctx = document.getElementById('memoryChart')?.getContext('2d');
  if (!ctx) return;

  if (window.memoryChartInstance) {
    window.memoryChartInstance.destroy();
  }

  window.memoryChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Memory Usage (MB)',
        data: [],
        borderColor: '#6441a5',
        backgroundColor: 'rgba(100, 65, 165, 0.1)',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 750 },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          ticks: {
            color: '#8892b0',
            callback: value => `${value.toFixed(1)} MB`
          }
        },
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          ticks: { color: '#8892b0' }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

// Add this after your existing initialization code
function initializeTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  function switchTab(tabId) {
    // Remove active class from all tabs and contents
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    // Add active class to selected tab and content
    const selectedTab = document.querySelector(`[data-tab="${tabId}"]`);
    const selectedContent = document.getElementById(`${tabId}Tab`);
    
    if (selectedTab && selectedContent) {
      selectedTab.classList.add('active');
      selectedContent.classList.add('active');
      activeTab = tabId;
    }
  }

  // Add click handlers to tab buttons
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabId = button.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // Initialize first tab
  switchTab('chat');
}

// Update your DOMContentLoaded event listener to include tab initialization
document.addEventListener('DOMContentLoaded', () => {
  if (initialized) return;
  initialized = true;
  
  console.log('Initializing...');
  channelTabs = new ChannelTabs();
  initializeMemoryChart();
  initializeSocket();
  initializeTabNavigation();

  // Set up message input handling
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');

  if (messageInput && sendButton) {
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    sendButton.addEventListener('click', sendMessage);
  }
});

// Update the sendMessage function
function sendMessage() {
  const messageInput = document.getElementById('messageInput');
  if (!messageInput || !socket || !channelTabs?.activeChannel) {
    console.log('Cannot send message:', {
      hasInput: !!messageInput,
      hasSocket: !!socket,
      activeChannel: channelTabs?.activeChannel
    });
    return;
  }
  
  const message = messageInput.value.trim();
  if (!message) return;
  
  console.log('Sending message:', {
    channel: channelTabs.activeChannel,
    message: message
  });

  socket.emit('sendMessage', {
    channel: channelTabs.activeChannel,
    message: message
  });
  
  messageInput.value = '';
}

// Add event listeners for message sending
document.addEventListener('DOMContentLoaded', () => {
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');

  if (messageInput && sendButton) {
    // Handle Enter key
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Handle button click
    sendButton.addEventListener('click', sendMessage);
  }
});

// Add the missing updateConnectionStatus function
function updateConnectionStatus(connected) {
  const statusDot = document.getElementById('connectionDot');
  const statusText = document.getElementById('connectionStatus');
  
  if (statusDot) {
    statusDot.style.backgroundColor = connected ? 'var(--success-color)' : 'var(--error-color)';
  }
  
  if (statusText) {
    statusText.textContent = connected ? 'Connected' : 'Disconnected';
    statusText.className = connected ? 'status-connected' : 'status-disconnected';
  }
}

// Add these new functions
function updateChannelsList() {
  const channelTabs = document.querySelector('.channel-tabs');
  if (!channelTabs) return;

  console.log('Updating channels list with:', Array.from(activeChannels.keys())); // Debug log
  
  channelTabs.innerHTML = '';
  
  Array.from(activeChannels.keys()).forEach(channel => {
    const tab = document.createElement('div');
    tab.className = `channel-tab ${channel === channelTabs.activeChannel ? 'active' : ''}`;
    tab.innerHTML = `
      <span class="channel-name">#${channel}</span>
      <button class="close-tab" onclick="event.stopPropagation(); leaveChannel('${channel}')">
        <i class="fas fa-times"></i>
      </button>
    `;
    tab.onclick = () => switchToChannel(channel);
    channelTabs.appendChild(tab);
  });
}

function switchToChannel(channel) {
  if (!channel) return;
  
  document.querySelectorAll('.channel-tab').forEach(tab => {
    const isActive = tab.textContent.includes(channel);
    tab.classList.toggle('active', isActive);
  });
  
  if (channelTabs) {
    channelTabs.activeChannel = channel;
    channelTabs.setActiveChannel(channel);
    loadChannelMessages(channel);
    
    // Store active channel in localStorage
    localStorage.setItem('activeChannel', channel);
  }
}

function loadChannelMessages(channel) {
  const chatBox = document.getElementById('chatBox');
  if (!chatBox) return;

  chatBox.innerHTML = '';
  const messages = activeChannels.get(channel)?.messages || [];
  messages.forEach(msg => addChatMessage(channel, msg));
  chatBox.scrollTop = chatBox.scrollHeight;
}

function addChatMessage(channel, messageData) {
  console.log('Adding chat message:', { channel, messageData });

  const channelName = messageData.channel || channel;
  const message = messageData;

  if (!activeChannels.has(channelName)) {
    activeChannels.set(channelName, { messages: [] });
  }
  activeChannels.get(channelName).messages.push(message);

  if (channelName === channelTabs?.activeChannel) {
    const chatBox = document.getElementById('chatBox');
    if (!chatBox) return;

    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    
    // Fix timestamp formatting
    const timestamp = new Date(message.timestamp);
    const timeString = timestamp.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const badgesHtml = message.badges ? 
      `<span class="badges">${formatBadges(message.badges)}</span>` : '';

    // Add bot message styling
    const isBot = message.username.toLowerCase() === 'tatsluna';
    const messageClass = isBot ? 'bot-message' : '';
    
    messageElement.innerHTML = `
      <span class="timestamp">${timeString}</span>
      ${badgesHtml}
      <span class="username ${messageClass}" style="color: ${message.color}">${message.username}:</span>
      <span class="message">${message.message}</span>
    `;
    
    chatBox.appendChild(messageElement);
    chatBox.scrollTop = chatBox.scrollHeight;
  }
}

function leaveChannel(channel) {
  if (!socket) return;
  socket.emit('leaveChannel', channel);
  showLoading();
}

// Add periodic stats update
function startPeriodicUpdates() {
  // Update stats every 5 seconds
  setInterval(() => {
    if (socket && socket.connected) {
      socket.emit('requestStats');
    }
  }, 5000);
}

// Update the initialization sequence
function initializeAll() {
  console.log('Initializing all components...');
  
  // Initialize socket first
  initializeSocket();
  
  // Initialize other components after socket is ready
  socket.on('connect', () => {
    console.log('Socket connected, initializing remaining components...');
    
    // Initialize ChannelTabs after socket is connected
    channelTabs = new ChannelTabs();
    channelTabs.initialize();
    
    initializeMemoryChart();
    initializeTabNavigation();

    // Request initial channels and stats
    socket.emit('getInitialChannels');
    socket.emit('requestStats');
  });
}

// Update the chat container HTML structure in index.html
function updateChatContainer() {
  const chatContainer = document.querySelector('.chat-container');
  if (!chatContainer) return;

  // Replace the existing chat-header with channel tabs
  chatContainer.innerHTML = `
    <div class="channel-tabs-container">
      <div class="channel-tabs"></div>
      <button class="new-tab-button" onclick="showJoinChannelDialog()">
        <i class="fas fa-plus"></i>
      </button>
    </div>
    <div class="chat-messages" id="chatBox"></div>
    <div class="chat-input">
      <input type="text" id="messageInput" placeholder="Type a message...">
      <button id="sendButton">
        <i class="fas fa-paper-plane"></i>
      </button>
    </div>
  `;

  // Initialize the channel tabs
  updateChannelsList();
}

// Add this function to show a join channel dialog
function showJoinChannelDialog() {
  const channelName = prompt('Enter channel name:');
  if (channelName) {
    joinChannel(channelName.toLowerCase().replace(/^#/, ''));
  }
}

// Add these styles to styles.css

// Add helper function to format badges
function formatBadges(badges) {
  if (typeof badges === 'string') {
    try {
      badges = JSON.parse(badges);
    } catch (e) {
      return '';
    }
  }
  
  return Object.entries(badges)
    .map(([type, version]) => `<img class="chat-badge" src="https://static-cdn.jtvnw.net/badges/v1/${type}/${version}/1" alt="${type}">`)
    .join('');
}

// Add helper function for formatting bytes
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

// Add this to your existing code
const defaultCommands = [
  { name: '#cute', description: 'Check how cute someone is' },
  { name: '#gay', description: 'Check how gay someone is' },
  { name: '#straight', description: 'Check how straight someone is' },
  { name: '#myd', description: 'Check someone\'s measurements' },
  { name: '#rate', description: 'Rate someone out of 10' },
  { name: '#horny', description: 'Check how horny someone is' },
  { name: '#iq', description: 'Check someone\'s IQ' },
  { name: '#sus', description: 'Check how sus someone is' },
  { name: '#all', description: 'Run all rate commands at once' },
  { name: '#gpt', description: 'Ask ChatGPT a question' },
  { name: '#weather', description: 'Check the weather' },
  { name: '#steam', description: 'Search Steam games' }
];

function populateCommandsList() {
  const commandsList = document.getElementById('commandsList');
  if (!commandsList) return;

  commandsList.innerHTML = defaultCommands.map(cmd => `
    <div class="command-item">
      <div>
        <div class="command-name">${cmd.name}</div>
        <div class="command-description">${cmd.description}</div>
      </div>
      <div class="command-actions">
        <button class="edit-command" onclick="editCommand('${cmd.name}')">
          <i class="fas fa-edit"></i>
        </button>
        <button class="delete-command" onclick="deleteCommand('${cmd.name}')">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

// Add this to your initialization
document.addEventListener('DOMContentLoaded', () => {
  // ... existing initialization code ...
  populateCommandsList();
});

// Update the channel tabs initialization
function initializeChannelTabs() {
  const container = document.querySelector('.channel-tabs');
  if (!container) return;

  // Get stored active channel or use default
  const storedChannel = localStorage.getItem('activeChannel') || 'revulate';
  
  if (socket) {
    socket.emit('getChannels', (channels) => {
      channels.forEach(channel => {
        const tab = document.createElement('button');
        tab.className = `channel-tab ${channel === storedChannel ? 'active' : ''}`;
        tab.textContent = `#${channel}`;
        tab.onclick = () => switchToChannel(channel);
        container.appendChild(tab);
      });
      
      // Set initial active channel
      switchToChannel(storedChannel);
    });
  }
}

// Update message timestamp formatting
function formatMessageTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch (error) {
    console.error('Error formatting timestamp:', error);
    return new Date().toLocaleTimeString();
  }
}

