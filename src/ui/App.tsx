import React, { useState, useRef, useEffect } from 'react';
import './index.css';

const SYSTEM_PROMPT = `You are an expert Figma designer AI. You output ONLY valid JSON, no markdown, no explanation, no code fences.

CRITICAL RULES:
- A4 portrait = width: 595, height: 842. A4 landscape = width: 842, height: 595. Default to PORTRAIT.
- NEVER invent text the user did not ask for. Only include text nodes with content the user explicitly specified.
- To center content in a frame, set layoutMode to "VERTICAL", primaryAxisAlignItems to "CENTER", counterAxisAlignItems to "CENTER".
- TEXT nodes must include "textAutoResize": "WIDTH_AND_HEIGHT" to prevent clipping.
- Root frames MUST use numeric width and height values (never "HUG" or "FILL").
- Use the user's exact words for any text content. Do not substitute or add placeholder text.

Your output must be a JSON object with this structure:

{
  "action": "CREATE_TREE",
  "root": {
    "type": "FRAME",
    "name": "<descriptive name>",
    "width": <number>,
    "height": <number>,
    "layoutMode": "VERTICAL" | "HORIZONTAL" | "NONE",
    "primaryAxisAlignItems": "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN",
    "counterAxisAlignItems": "MIN" | "CENTER" | "MAX",
    "itemSpacing": <number>,
    "paddingTop": <number>, "paddingRight": <number>, "paddingBottom": <number>, "paddingLeft": <number>,
    "fills": [{"type": "SOLID", "color": "#hex"} or {"type": "GRADIENT_LINEAR", "stops": [{"position": 0, "color": "#hex"}, ...]}],
    "effects": [{"type": "DROP_SHADOW", "radius": <n>, "offset": {"x": <n>, "y": <n>}, "color": "#hex"}],
    "cornerRadius": <number>,
    "children": [<child nodes>]
  }
}

Child node types:
- FRAME: container with all properties above, can have children
- RECTANGLE: width, height, fills, cornerRadius, effects, strokes
- TEXT: characters (the actual text string from user), fontSize, fontName {"family": "...", "style": "..."}, fills, textAlignHorizontal ("LEFT"|"CENTER"|"RIGHT"), textAutoResize ("WIDTH_AND_HEIGHT")
- IMAGE_NODE: width, height, cornerRadius, imageData: "UPLOADED_IMAGE_PLACEHOLDER"

Remember: ONLY include text that the user explicitly requested. Do not add any placeholder or example text.`;

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

function App() {
  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(true);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Once API key is entered, hide settings
  useEffect(() => {
    if (apiKey.length > 10) setShowSettings(false);
  }, [apiKey]);

  // Resize handle
  useEffect(() => {
    const handle = resizeRef.current;
    if (!handle) return;
    let startX = 0, startY = 0, startW = 320, startH = 480;

    const onMouseMove = (e: MouseEvent) => {
      const w = Math.max(280, startW + (e.clientX - startX));
      const h = Math.max(300, startH + (e.clientY - startY));
      parent.postMessage({ pluginMessage: { type: 'resize', width: w, height: h } }, '*');
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    const onMouseDown = (e: MouseEvent) => {
      startX = e.clientX;
      startY = e.clientY;
      startW = window.innerWidth;
      startH = window.innerHeight;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };
    handle.addEventListener('mousedown', onMouseDown);
    return () => handle.removeEventListener('mousedown', onMouseDown);
  }, []);

  // Listen for messages from the Figma sandbox
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data?.pluginMessage;
      if (msg?.type === 'success') {
        addMessage('system', msg.message);
      }
      if (msg?.type === 'error') {
        addMessage('system', 'Error: ' + msg.message);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const addMessage = (role: ChatMessage['role'], content: string) => {
    setMessages(prev => [...prev, { role, content, timestamp: Date.now() }]);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      setSelectedImage(base64);
      addMessage('system', 'Image "' + file.name + '" attached');
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = async () => {
    if (!apiKey) { setShowSettings(true); addMessage('system', 'Please set your Gemini API Key.'); return; }
    if (!prompt.trim()) return;

    const userPrompt = prompt;
    setPrompt('');
    addMessage('user', userPrompt);
    setLoading(true);

    try {
      let fullPrompt = userPrompt;
      if (selectedImage) {
        fullPrompt += '\n\n[USER HAS UPLOADED AN IMAGE. Use IMAGE_NODE with imageData: "UPLOADED_IMAGE_PLACEHOLDER" where appropriate.]';
      }

      const response = await fetch(GEMINI_API_URL + '?key=' + apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: SYSTEM_PROMPT + '\n\nUser request: ' + fullPrompt }]
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.7,
          }
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || ('API Error: ' + response.status));
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) throw new Error('Empty response from Gemini');

      let actionJson = JSON.parse(content);

      // Inject uploaded image
      if (selectedImage) {
        const injectImage = (node: any) => {
          if (node.type === 'IMAGE_NODE' && node.imageData === 'UPLOADED_IMAGE_PLACEHOLDER') {
            node.imageData = selectedImage;
          }
          if (node.children) node.children.forEach(injectImage);
        };
        if (actionJson.root) injectImage(actionJson.root);
      }

      addMessage('assistant', 'Building design on canvas...');
      parent.postMessage({ pluginMessage: { type: 'AI_ACTION', action: actionJson } }, '*');

      setSelectedImage(null);
      setImageName('');
    } catch (error: any) {
      console.error(error);
      addMessage('system', 'Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <div className="chat-root">
      {/* Header */}
      <div className="chat-header">
        <span className="chat-title">Figma Agent</span>
        <div className="header-actions">
          {imageName && <span className="attached-badge">{imageName}</span>}
          <button className="icon-btn" onClick={() => fileInputRef.current?.click()} title="Attach image">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M14 10V12.667A1.334 1.334 0 0112.667 14H3.333A1.334 1.334 0 012 12.667V10M11.333 5.333L8 2M8 2L4.667 5.333M8 2v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(!showSettings)} title="Settings">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 10a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" strokeWidth="1.5" /><path d="M13.4 10a1.1 1.1 0 00.2 1.2l.04.04a1.333 1.333 0 11-1.886 1.886l-.04-.04a1.1 1.1 0 00-1.2-.2 1.1 1.1 0 00-.667 1.007v.113a1.333 1.333 0 01-2.667 0v-.06A1.1 1.1 0 006 13.4a1.1 1.1 0 00-1.2.2l-.04.04a1.333 1.333 0 11-1.886-1.886l.04-.04a1.1 1.1 0 00.2-1.2A1.1 1.1 0 002.107 9.85h-.114a1.333 1.333 0 010-2.667h.06A1.1 1.1 0 002.6 6a1.1 1.1 0 00-.2-1.2l-.04-.04A1.333 1.333 0 114.246 2.874l.04.04a1.1 1.1 0 001.2.2h.053a1.1 1.1 0 00.667-1.007v-.114a1.333 1.333 0 012.667 0v.06A1.1 1.1 0 0010 2.6a1.1 1.1 0 001.2-.2l.04-.04a1.333 1.333 0 011.886 1.886l-.04.04a1.1 1.1 0 00-.2 1.2v.053a1.1 1.1 0 001.007.667h.114a1.333 1.333 0 010 2.667h-.06A1.1 1.1 0 0013.4 10z" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
        </div>
        <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageUpload} style={{ display: 'none' }} />
      </div>

      {/* Settings Panel (collapsible) */}
      {showSettings && (
        <div className="settings-panel">
          <label className="settings-label">Gemini API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="AIza..."
            className="settings-input"
          />
          <span className="settings-hint">
            Free from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com</a>
          </span>
        </div>
      )}

      {/* Chat Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-text">Describe a design to generate it on your canvas.</div>
            <div className="empty-hint">Tip: be specific about dimensions, colors, and text content.</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={'chat-msg ' + msg.role}>
            <div className="msg-bubble">
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="chat-msg assistant">
            <div className="msg-bubble loading-bubble">
              <span className="dot-pulse"></span> Generating...
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Bar */}
      <div className="chat-input-bar">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your design..."
          rows={1}
          className="chat-input"
          disabled={loading}
        />
        <button
          onClick={handleGenerate}
          disabled={loading || !prompt.trim()}
          className="send-btn"
        >
          {loading ? '...' : '\u27A4'}
        </button>
      </div>

      {/* Resize Handle */}
      <div ref={resizeRef} className="resize-handle" />
    </div>
  );
}

export default App;
