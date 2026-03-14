const fs = require('fs');
const path = require('path');

const captureFilePath = path.join(__dirname, '..', 'extracted_logs', 'logs', 'capture_1.log');
const eventsFilePath = path.join(__dirname, '..', 'events_log.json');

const usersMap = {};

try {
  // 1. Recover from events_log.json
  const eventsData = fs.readFileSync(eventsFilePath, 'utf8');
  const events = JSON.parse(eventsData);
  
  events.forEach(event => {
    if (event.userId && event.userName) {
      if (!usersMap[event.userId]) {
        usersMap[event.userId] = {
          email: event.userId,
          name: event.userName,
          mockIp: event.mockIp || null,
          emailConsent: false, // Default unless found in Capture
          lastSeen: event.timestamp || new Date().toISOString()
        };
      }
      // Update last seen
      if (event.timestamp && new Date(event.timestamp) > new Date(usersMap[event.userId].lastSeen)) {
        usersMap[event.userId].lastSeen = event.timestamp;
      }
    }
  });

  // 2. Recover from capture_1.log
  if (fs.existsSync(captureFilePath)) {
    const captureData = fs.readFileSync(captureFilePath, 'utf8');
    const registeredUserRegex = /Registered user:\s*\{([^}]+)\}/g;
    
    let match;
    while ((match = registeredUserRegex.exec(captureData)) !== null) {
      const block = match[1];
      
      const emailMatch = block.match(/email:\s*'([^']+)'/);
      const nameMatch = block.match(/name:\s*'([^']+)'/);
      const mockIpMatch = block.match(/mockIp:\s*'([^']+)'/);
      const emailConsentMatch = block.match(/emailConsent:\s*(true|false)/);
      const lastSeenMatch = block.match(/lastSeen:\s*'([^']+)'/);
      
      if (emailMatch) {
        const email = emailMatch[1];
        
        if (!usersMap[email]) {
          usersMap[email] = {
            email: email,
            name: nameMatch ? nameMatch[1] : 'Unknown',
            mockIp: mockIpMatch ? mockIpMatch[1] : null,
            emailConsent: emailConsentMatch ? emailConsentMatch[1] === 'true' : false,
            lastSeen: lastSeenMatch ? lastSeenMatch[1] : new Date().toISOString()
          };
        } else {
          if (emailConsentMatch) {
             usersMap[email].emailConsent = emailConsentMatch[1] === 'true';
          }
        }
      }
    }
  }

  // Convert to expected users.json format
  const recoveredUsers = Object.values(usersMap).map(u => ({...u}));
  
  fs.writeFileSync(
    path.join(__dirname, 'recovered_users.json'), 
    JSON.stringify(recoveredUsers, null, 2), 
    'utf8'
  );

  console.log(`Successfully recovered ${recoveredUsers.length} users. Saved to recovered_users.json`);
} catch (error) {
  console.error("Error during recovery:", error);
}
