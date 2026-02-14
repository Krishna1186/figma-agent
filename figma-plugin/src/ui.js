// Plugin UI runs in iframe; talks to main thread via parent.postMessage
document.getElementById('run').onclick = function () {
  const prompt = document.getElementById('prompt').value.trim();
  if (!prompt) return;
  parent.postMessage({ pluginMessage: { type: 'run', prompt: prompt } }, '*');
  document.getElementById('log').textContent = 'Running...';
};

window.onmessage = function (event) {
  const msg = event.data.pluginMessage;
  if (!msg) return;
  const log = document.getElementById('log');
  if (msg.type === 'done') {
    log.textContent = 'Done. Applied ' + (msg.ops || 0) + ' op(s).';
  } else if (msg.type === 'error') {
    log.textContent = 'Error: ' + (msg.message || 'Unknown');
  }
};
