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
  console.log('Updating dashboard with status:', status); // Debug log

  // Update bot status
  const botStatusEl = document.getElementById('botStatus');
  if (botStatusEl) {
    botStatusEl.textContent = status.connected ? 'Online' : 'Offline';
    botStatusEl.className = status.connected ? 'status-connected' : 'status-disconnected';
  }

  // Update channel count
  const channelCountEl = document.getElementById('channelCount');
  if (channelCountEl && status.stats) {
    channelCountEl.textContent = `${status.stats.channelCount || 0} channels`;
  }

  // Update uptime
  const uptimeEl = document.getElementById('uptime');
  if (uptimeEl && status.startTime) {
    const uptime = Date.now() - new Date(status.startTime).getTime();
    uptimeEl.textContent = formatUptime(uptime);
  }

  // Update memory chart with the correct memory value
  if (status.memory) {
    const memoryInMB = status.memory / (1024 * 1024); // Convert bytes to MB
    updateMemoryChart(memoryInMB.toFixed(2), new Date().toLocaleTimeString());
  }
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
    console.log('Received bot stats:', stats); // Debug log
    updateDashboard({
      connected: stats.isConnected,
      stats: {
        channelCount: stats.channels.length,
        totalMessages: stats.messageCount
      },
      startTime: stats.startTime,
      memory: stats.memoryUsage
    });
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
  logEntry.className = `log-entry log-${log.level}`;
  
  const timestamp = new Date(log.timestamp).toLocaleTimeString();
  logEntry.innerHTML = `
    <span class="log-timestamp">${timestamp}</span>
    <span class="log-level">[${log.level.toUpperCase()}]</span>
    <span class="log-message">${log.message}</span>
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
    
    // Remove the immediate socket.emit call
    // We'll load channels after socket is initialized
  }

  initialize() {
    if (socket) {
      socket.emit('getInitialChannels');
    }
  }

  addChannel(channel) {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, {
        messages: [],
        unread: 0
      });
      activeChannels.set(channel, { messages: [] });
      updateChannelsList();
    }
  }

  removeChannel(channel) {
    this.channels.delete(channel);
    activeChannels.delete(channel);
    if (this.activeChannel === channel) {
      this.activeChannel = Array.from(this.channels.keys())[0] || null;
    }
    updateChannelsList();
  }

  setActiveChannel(channel) {
    this.activeChannel = channel;
    if (this.channels.has(channel)) {
      this.channels.get(channel).unread = 0;
    }
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
  const canvas = document.getElementById('memoryChart');
  if (!canvas) return;

  // Clear any existing chart instance
  if (window.memoryChartInstance) {
    window.memoryChartInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  
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
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: '#8892b0'
          }
        },
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: '#8892b0'
          }
        }
      },
      plugins: {
        legend: {
          labels: {
            color: '#ffffff'
          }
        }
      }
    }
  });

  memoryChart = window.memoryChartInstance;
}

// Update the updateMemoryChart function to use the global instance
function updateMemoryChart(memoryUsage, timestamp) {
  if (!window.memoryChartInstance) return;

  const maxDataPoints = 10;
  
  window.memoryChartInstance.data.labels.push(timestamp);
  window.memoryChartInstance.data.datasets[0].data.push(memoryUsage);

  if (window.memoryChartInstance.data.labels.length > maxDataPoints) {
    window.memoryChartInstance.data.labels.shift();
    window.memoryChartInstance.data.datasets[0].data.shift();
  }

  window.memoryChartInstance.update();
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

// Add the missing sendMessage function
function sendMessage() {
  const messageInput = document.getElementById('messageInput');
  if (!messageInput || !socket) return;
  
  const message = messageInput.value.trim();
  if (!message) return;
  
  socket.emit('chatMessage', {
    channel: channelTabs.activeChannel,
    message: message
  });
  
  messageInput.value = '';
}

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

  channelTabs.innerHTML = '';
  
  // Add tab for each channel
  Array.from(activeChannels.keys()).forEach(channel => {
    const tab = document.createElement('div');
    tab.className = `channel-tab ${channel === activeTab ? 'active' : ''}`;
    tab.innerHTML = `
      <span>${channel}</span>
      <button class="close-tab" onclick="leaveChannel('${channel}')">×</button>
    `;
    tab.onclick = () => switchToChannel(channel);
    channelTabs.appendChild(tab);
  });
}

function switchToChannel(channel) {
  if (!channel) return;
  
  // Update active states
  document.querySelectorAll('.channel-tab').forEach(tab => {
    tab.classList.toggle('active', tab.textContent.includes(channel));
  });
  
  activeTab = channel;
  channelTabs.setActiveChannel(channel);
  
  // Clear and load messages for this channel
  const chatBox = document.getElementById('chatBox');
  if (chatBox) {
    chatBox.innerHTML = '';
    const messages = activeChannels.get(channel)?.messages || [];
    messages.forEach(msg => addChatMessage(channel, msg));
  }
}

function addChatMessage(channel, messageData) {
  console.log('Adding chat message:', { channel, messageData }); // Debug log

  // Handle both message formats
  const channelName = messageData.channel || channel;
  const message = messageData;

  // Store message in channel history
  if (!activeChannels.has(channelName)) {
    activeChannels.set(channelName, { messages: [] });
  }
  activeChannels.get(channelName).messages.push(message);

  // If this is the active channel, display the message
  if (channelName === channelTabs.activeChannel) {
    const chatBox = document.getElementById('chatBox');
    if (!chatBox) return;

    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    
    const timestamp = new Date(message.timestamp).toLocaleTimeString();
    const badgesHtml = message.badges ? 
      `<span class="badges">${formatBadges(message.badges)}</span>` : '';

    messageElement.innerHTML = `
      <span class="timestamp">${timestamp}</span>
      ${badgesHtml}
      <span class="username" style="color: ${message.color}">${message.username}:</span>
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

    // Request initial stats
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

// Update the updateChannelsList function
function updateChannelsList() {
  const channelTabs = document.querySelector('.channel-tabs');
  if (!channelTabs) return;

  channelTabs.innerHTML = '';
  
  Array.from(activeChannels.keys()).forEach(channel => {
    const tab = document.createElement('div');
    tab.className = `channel-tab ${channel === activeTab ? 'active' : ''}`;
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
