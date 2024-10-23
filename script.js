// Update addChatMessage function with better timestamp handling
function addChatMessage(channel, messageData) {
  console.log('Adding chat message:', { channel, messageData });

  const channelName = messageData.channel || channel;
  
  if (!activeChannels.has(channelName)) {
    activeChannels.set(channelName, { messages: [] });
  }
  activeChannels.get(channelName).messages.push(messageData);

  if (channelName === channelTabs?.activeChannel) {
    const chatBox = document.getElementById('chatBox');
    if (!chatBox) return;

    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    
    // Use the updated formatTimestamp function
    const timeString = formatTimestamp(messageData.timestamp);
    
    const badgesHtml = messageData.badges ? 
      `<span class="badges">${formatBadges(messageData.badges)}</span>` : '';

    const isBot = messageData.username?.toLowerCase() === 'tatsluna';
    const messageClass = isBot ? 'bot-message' : '';
    
    messageElement.innerHTML = `
      <span class="timestamp">${timeString}</span>
      ${badgesHtml}
      <span class="username ${messageClass}" style="color: ${messageData.color || '#FFFFFF'}">${messageData.username}:</span>
      <span class="message">${messageData.message}</span>
    `;
    
    chatBox.appendChild(messageElement);
    chatBox.scrollTop = chatBox.scrollHeight;
  }
}

// Update channel switching with stronger active state
function switchToChannel(channel) {
  if (!channel) return;
  
  // Update all channel tabs with more visible active state
  document.querySelectorAll('.channel-tab').forEach(tab => {
    const isActive = tab.textContent.includes(channel);
    tab.classList.toggle('active', isActive);
    
    // Force active styles
    if (isActive) {
      tab.style.cssText = `
        background: var(--primary-color) !important;
        color: var(--text-color) !important;
        box-shadow: 0 0 0 2px var(--primary-color) !important;
        font-weight: 500;
      `;
    } else {
      tab.style.cssText = '';
    }
  });
  
  if (channelTabs) {
    channelTabs.activeChannel = channel;
    channelTabs.setActiveChannel(channel);
    loadChannelMessages(channel);
    
    // Store active channel
    localStorage.setItem('activeChannel', channel);
  }
}

// Update timestamp formatting function
function formatTimestamp(timestamp) {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) throw new Error('Invalid date');
    
    // Format time in 12-hour format with AM/PM
    const timeString = date.toLocaleTimeString('en-US', {
      hour: 'numeric', // Use numeric for 12-hour format
      minute: '2-digit',
      second: '2-digit',
      hour12: true // Force 12-hour format with AM/PM
    }).replace(/^(\d{1,2}):/, (match, hour) => {
      // Ensure consistent padding for single-digit hours
      return hour.padStart(2, '0') + ':';
    });

    return timeString;
  } catch (error) {
    console.error('Error formatting timestamp:', error);
    // Fallback to current time in same format
    return new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }
}

// Update log entry formatting
function addLogEntry(log) {
  const logsBox = document.getElementById('logsBox');
  if (!logsBox) return;

  const logEntry = document.createElement('div');
  logEntry.className = `log-entry log-${log.level?.toLowerCase() || 'info'}`;
  
  const timeString = formatTimestamp(log.timestamp);
  
  logEntry.innerHTML = `
    <span class="log-timestamp">${timeString}</span>
    <span class="log-level">[${(log.level || 'INFO').toUpperCase()}]</span>
    <span class="log-message">${log.message || ''}</span>
  `;
  
  logsBox.appendChild(logEntry);
  logsBox.scrollTop = logsBox.scrollHeight;
}
