const $ = (id) => document.getElementById(id);

const send = (message) =>
  new Promise((resolve) => chrome.runtime.sendMessage(message, (r) => resolve(r || {})));

// Google OAuth configuration - replace with your client ID
const GOOGLE_CLIENT_ID = '691911053932-pkaiaevm43hovq4nshqjj6i93c2f94fn.apps.googleusercontent.com';
const SCOPES = ['email', 'profile'];

let user = null;
let uploadedFiles = [];

async function load() {
  // Check if user is already signed in
  const { config } = await send({ type: 'getConfig' });
  if (config?.user) {
    user = config.user;
    showMeetingSection();
  }
}

function showStatus(text, isError) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (isError ? ' error' : '');
}

function showAuthSection() {
  $('authSection').style.display = 'block';
  $('meetingSection').style.display = 'none';
}

async function showMeetingSection() {
  $('authSection').style.display = 'none';
  $('meetingSection').style.display = 'block';
  $('userEmail').textContent = user.email;
  
  // Load meeting data
  const { config } = await send({ type: 'getConfig' });
  if (config?.activeMeeting) {
    $('link').value = config.activeMeeting.link || '';
    $('title').value = config.activeMeeting.title || '';
    $('context').value = config.activeMeeting.context || '';
  }
  $('autoAnswer').checked = Boolean(config?.autoAnswer);
  $('autoSend').checked = Boolean(config?.autoSend);
}

async function signInWithGoogle() {
  try {
    showStatus('Signing in...');
    
    // Use Chrome Identity API for OAuth with web application client
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&response_type=token&scope=${encodeURIComponent(SCOPES.join(' '))}&redirect_uri=${encodeURIComponent(chrome.identity.getRedirectURL())}`;
    
    const token = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl, interactive: true },
        (responseUrl) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (responseUrl) {
            const params = new URLSearchParams(responseUrl.split('#')[1]);
            resolve(params.get('access_token'));
          } else {
            reject(new Error('No response URL'));
          }
        }
      );
    });
    
    if (token) {
      // Get user info from Google
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const userInfo = await userInfoResponse.json();
      
      user = {
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        token: token
      };
      
      // Save user to config
      await send({ type: 'setConfig', patch: { user } });
      
      // Register user with backend
      try {
        const { config: backendConfig } = await send({ type: 'getConfig' });
        const backendUrl = backendConfig?.backendUrl || 'https://interview-ai-backend-tlka.onrender.com';
        await fetch(`${backendUrl.replace(/\/$/, '')}/api/admin/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: user.email,
            name: user.name,
            picture: user.picture
          })
        });
      } catch (err) {
        console.log('Failed to register user with backend:', err);
      }
      
      showMeetingSection();
      showStatus('Signed in successfully!');
    }
  } catch (error) {
    console.error('Google sign-in failed:', error);
    showStatus('Sign-in failed. Please try again.', true);
  }
}

async function signOut() {
  user = null;
  await send({ type: 'setConfig', patch: { user: null } });
  showAuthSection();
  showStatus('Signed out');
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('userId', user.email);
  
  try {
    const { config } = await send({ type: 'getConfig' });
    const backendUrl = (config?.backendUrl || 'http://localhost:4000').replace(/\/$/, '');
    
    const response = await fetch(`${backendUrl}/api/upload`, {
      method: 'POST',
      body: formData
    });
    
    if (response.ok) {
      const result = await response.json();
      return result.fileId;
    } else {
      throw new Error('Upload failed');
    }
  } catch (error) {
    throw error;
  }
}

function renderFileList() {
  const fileList = $('fileList');
  fileList.innerHTML = uploadedFiles.map(f => 
    `<div class="file-item">
      <span>${f.name}</span>
      <button onclick="removeFile('${f.id}')" class="link">×</button>
    </div>`
  ).join('');
}

window.removeFile = (fileId) => {
  uploadedFiles = uploadedFiles.filter(f => f.id !== fileId);
  renderFileList();
};

async function save() {
  if (!user) {
    showStatus('Please sign in first', true);
    return;
  }
  
  showStatus('Preparing your AI assistance...');
  
  // Upload files first
  const fileIds = [];
  for (const file of uploadedFiles) {
    if (!file.uploaded) {
      try {
        const fileId = await uploadFile(file.file);
        fileIds.push(fileId);
        file.uploaded = true;
      } catch (error) {
        showStatus(`Failed to upload ${file.name}`, true);
        return;
      }
    } else {
      fileIds.push(file.id);
    }
  }
  
  const link = $('link').value.trim();
  const patch = {
    user,
    activeMeeting: link
      ? { 
          link, 
          title: $('title').value.trim(), 
          context: $('context').value.trim(),
          fileIds 
        }
      : null,
    // Reset userClosed flag when saving a new meeting (only if link is provided)
    userClosed: link ? false : undefined,
    autoAnswer: $('autoAnswer').checked,
    autoSend: $('autoSend').checked,
  };
  
  const resp = await send({ type: 'setConfig', patch });
  if (resp.ok) {
    showStatus('AI assistance ready!');
    uploadedFiles = [];
    renderFileList();
    
    // Try to activate overlay on current tab if it's a meeting page
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        // Check if current tab is a meeting page
        const isMeetingPage = tab.url.includes('meet.google.com') || 
                              tab.url.includes('teams.microsoft.com') || 
                              tab.url.includes('teams.live.com');
        
        if (isMeetingPage) {
          // Send message to content script to re-evaluate and activate overlay
          const messageResponse = await chrome.tabs.sendMessage(tab.id, { type: 'recheckConfig' });
          if (!messageResponse || !messageResponse.ok) {
            throw new Error('Content script did not respond');
          }
        } else {
          // Current tab is not a meeting page
          showStatus('AI assistance ready! Navigate to your meeting page.');
        }
      }
    } catch (e) {
      console.log('Failed to activate overlay:', e.message);
      showStatus('AI assistance ready! Please refresh the meeting tab.');
    }
  } else {
    showStatus(resp.error || 'Could not save.', true);
  }
}

$('signInBtn').addEventListener('click', signInWithGoogle);
$('signOutBtn').addEventListener('click', signOut);
$('save').addEventListener('click', save);

$('fileInput').addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    uploadedFiles.push({
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      name: file.name,
      file: file,
      uploaded: false
    });
  });
  renderFileList();
});

load();
