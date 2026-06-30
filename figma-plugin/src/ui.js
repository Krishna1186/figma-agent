(function () {
  var chatEl = document.getElementById('chat');
  var dropzoneEl = document.getElementById('dropzone');
  var fileInputEl = document.getElementById('file-input');
  var uploadBtnEl = document.getElementById('upload-btn');
  var promptEl = document.getElementById('prompt');
  var sendBtnEl = document.getElementById('send-btn');
  var statusEl = document.getElementById('status');

  function appendMessage(role, text) {
    var msg = document.createElement('div');
    msg.className = 'msg ' + role;
    msg.textContent = text;
    chatEl.appendChild(msg);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function setStatus(text) {
    statusEl.textContent = text || '';
  }

  function handleFile(file) {
    if (!file) return;
    var ok = file.type === 'application/pdf' || file.type.indexOf('image/') === 0;
    if (!ok) {
      appendMessage('assistant', 'Only PDF and image files are supported.');
      return;
    }

    appendMessage('user', 'Uploaded: ' + file.name + ' (' + (file.type || 'unknown') + ')');
    setStatus('Reading file...');

    var reader = new FileReader();
    reader.onload = function () {
      parent.postMessage({
        pluginMessage: {
          type: 'file-selected',
          data: reader.result,
          fileName: file.name,
          fileType: file.type
        }
      }, '*');
      setStatus('Decomposing...');
    };
    reader.readAsDataURL(file);
  }

  dropzoneEl.addEventListener('click', function () {
    fileInputEl.click();
  });

  uploadBtnEl.addEventListener('click', function () {
    fileInputEl.click();
  });

  dropzoneEl.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropzoneEl.classList.add('active');
  });

  dropzoneEl.addEventListener('dragleave', function () {
    dropzoneEl.classList.remove('active');
  });

  dropzoneEl.addEventListener('drop', function (e) {
    e.preventDefault();
    dropzoneEl.classList.remove('active');
    var file = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
    handleFile(file);
  });

  fileInputEl.addEventListener('change', function () {
    var file = fileInputEl.files && fileInputEl.files[0] ? fileInputEl.files[0] : null;
    handleFile(file);
  });

  function sendPrompt() {
    var prompt = promptEl.value.trim();
    if (!prompt) return;
    appendMessage('user', prompt);
    promptEl.value = '';
    setStatus('Applying edit...');
    parent.postMessage({ pluginMessage: { type: 'run-edit', prompt: prompt } }, '*');
  }

  sendBtnEl.addEventListener('click', sendPrompt);
  promptEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  });

  window.onmessage = function (event) {
    var msg = event.data && event.data.pluginMessage;
    if (!msg) return;

    if (msg.type === 'chat') {
      appendMessage(msg.role === 'user' ? 'user' : 'assistant', msg.text || '');
      return;
    }

    if (msg.type === 'progress') {
      setStatus(msg.stage + ': ' + (msg.message || ''));
      return;
    }

    if (msg.type === 'done') {
      appendMessage('assistant', msg.message || 'Done.');
      setStatus('Ready');
      return;
    }

    if (msg.type === 'error') {
      appendMessage('assistant', 'Error: ' + (msg.message || 'Unknown error'));
      setStatus('Failed');
    }
  };

  appendMessage('assistant', 'Upload a PDF or image to begin decomposition.');
  setStatus('Ready');
})();
