const $ = (id) => document.getElementById(id);

const send = (message) =>
  new Promise((resolve) => chrome.runtime.sendMessage(message, (r) => resolve(r || {})));

function showStatus(text, isError) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (isError ? ' error' : '');
}

async function load() {
  const { config } = await send({ type: 'getConfig' });
  if (!config) return;
  $('enabled').checked = config.enabled !== false;
}

async function save() {
  const patch = {
    enabled: $('enabled').checked,
  };
  const resp = await send({ type: 'setConfig', patch });
  if (resp.ok) showStatus('Settings saved.');
  else showStatus(resp.error || 'Could not save settings.', true);
}

$('save').addEventListener('click', save);
load();
