// Fluid Workspace - Client Application Orchestrator

document.addEventListener('DOMContentLoaded', () => {
  // Application State
  let widgets = [];
  let pipelines = [];
  let chatHistory = [];
  let pendingLayoutProposal = null; // Holds the proposed layouts during "Shadow State" preview
  
  // Workspace State Variables (shared with widgets)
  window.__workspace_variables = {};
  
  // Element Cache
  const widgetGrid = document.getElementById('widget-grid');
  const connectionSvg = document.getElementById('connection-svg');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('prompt-field');
  const chatSendBtn = document.getElementById('chat-send-btn');
  const agentStatus = document.getElementById('agent-status');
  const toolList = document.getElementById('tool-list');
  const toolsCount = document.getElementById('tools-count');
  const pipelineList = document.getElementById('pipeline-list');
  const pipelinesCount = document.getElementById('pipelines-count');
  const clearCanvasBtn = document.getElementById('clear-canvas-btn');
  const apiStatus = document.getElementById('api-status');
  const apiKeyInput = document.getElementById('token-field');
  const saveKeyBtn = document.getElementById('save-key-btn');
  const timelineToggle = document.getElementById('timeline-toggle');
  const timelineStatus = document.getElementById('timeline-status');
  const commitPreviewBtn = document.getElementById('commit-preview-btn');
  const helpBtn = document.getElementById('help-btn');

  // --- API Key Setup & Validation ---
  let geminiApiKey = localStorage.getItem('gemini_api_key') || '';
  if (geminiApiKey) {
    apiKeyInput.placeholder = 'Key Configured (Saved in LocalStorage)';
    apiStatus.classList.add('active');
  }

  saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key.startsWith('AIzaSy')) { // Standard Gemini API prefix
      localStorage.setItem('gemini_api_key', key);
      geminiApiKey = key;
      apiStatus.classList.add('active');
      apiKeyInput.value = '';
      apiKeyInput.placeholder = 'Key Configured (Saved in LocalStorage)';
      addSystemMessage('API Key activated successfully.');
    } else if (key === '') {
      localStorage.removeItem('gemini_api_key');
      geminiApiKey = '';
      apiStatus.classList.remove('active');
      addSystemMessage('API Key removed.');
    } else {
      alert('Please enter a valid Gemini API Key starting with AIzaSy');
    }
  });

  // --- Grid Slot Solver (Collision Detection) ---
  function findEmptyGridSlot(w, h) {
    let x = 1, y = 1;
    let collision = true;
    while (collision) {
      collision = false;
      for (const widget of widgets) {
        const xOverlap = (x < widget.x + widget.w) && (x + w > widget.x);
        const yOverlap = (y < widget.y + widget.h) && (y + h > widget.y);
        if (xOverlap && yOverlap) {
          collision = true;
          x += 1;
          if (x + w > 13) {
            x = 1;
            y += 1;
          }
          break;
        }
      }
    }
    return { x, y };
  }

  // --- Widget Creation & Rendering ---
  function createWidgetCard(widget) {
    const card = document.createElement('div');
    card.className = 'widget-card glass';
    card.id = `card-${widget.id}`;
    
    // Set position
    card.style.gridColumn = `${widget.x} / span ${widget.w}`;
    card.style.gridRow = `${widget.y} / span ${widget.h}`;

    // Left input handle, right output handle for connecting nodes
    const inputHandle = document.createElement('div');
    inputHandle.className = 'node-handle input';
    inputHandle.title = 'Input Node';
    inputHandle.dataset.id = widget.id;

    const outputHandle = document.createElement('div');
    outputHandle.className = 'node-handle output';
    outputHandle.title = 'Output Node';
    outputHandle.dataset.id = widget.id;

    // Titlebar
    const titlebar = document.createElement('div');
    titlebar.className = 'widget-titlebar';
    
    const title = document.createElement('div');
    title.className = 'widget-title';
    title.innerHTML = `<span class="widget-drag-grip">⋮⋮</span><span class="widget-status-light"></span> ${widget.title}`;

    const actions = document.createElement('div');
    actions.className = 'widget-actions';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'widget-btn';
    deleteBtn.title = 'Remove';
    deleteBtn.innerHTML = '✕';
    deleteBtn.onclick = () => deleteWidget(widget.id);

    actions.appendChild(deleteBtn);
    titlebar.appendChild(title);
    titlebar.appendChild(actions);

    // Iframe Sandbox container
    const body = document.createElement('div');
    body.className = 'widget-body';

    const iframe = document.createElement('iframe');
    iframe.className = 'widget-sandbox';
    iframe.id = `iframe-${widget.id}`;
    // sandbox attributes (excluding same-origin would block navigator.modelContext access)
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');

    body.appendChild(iframe);
    card.appendChild(inputHandle);
    card.appendChild(outputHandle);
    card.appendChild(titlebar);
    card.appendChild(body);

    widgetGrid.appendChild(card);

    // Build the iframe contents
    // Write dynamic styles and logic, polyfilling navigator.modelContext
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            margin: 0;
            padding: 12px;
            font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
            color: hsl(0, 0%, 95%);
            background: transparent;
          }
          /* Custom styles injected by LLM */
          ${widget.css || ''}
        </style>
      </head>
      <body>
        <div class="widget-content">
          ${widget.html}
        </div>
        <script>
          // Bridge to parent workspace polyfill
          window.navigator.modelContext = window.parent.navigator.modelContext;
          
          // Let widget update workspace state variables
          window.updateVariable = (key, val) => {
            window.parent.updateWorkspaceVariable("${widget.id}", key, val);
          };

          // Auto-trigger forms scan on load inside the frame
          window.addEventListener('DOMContentLoaded', () => {
            window.parent.webmcp.scanForms(document);
          });

          // Run widget code
          try {
            ${widget.js || ''}
          } catch(e) {
            console.error("Error in widget [${widget.id}] script:", e);
          }
        </script>
      </body>
      </html>
    `);
    doc.close();

    // Enable dragging
    makeCardDraggable(card, widget);
    
    // Draw connections whenever layout changes
    requestAnimationFrame(drawPipelines);
  }

  // --- Drag & Drop Handlers ---
  function makeCardDraggable(card, widget) {
    const titlebar = card.querySelector('.widget-titlebar');
    let startX, startY;
    let initialX, initialY;
    let isDragging = false;
    let ghost = null;

    titlebar.addEventListener('pointerdown', (e) => {
      if (pendingLayoutProposal) return; // Lock dragging during preview
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      
      const gridRect = widgetGrid.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      
      initialX = cardRect.left - gridRect.left;
      initialY = cardRect.top - gridRect.top;
      
      isDragging = true;
      card.classList.add('dragging');
      card.setPointerCapture(e.pointerId);

      // Create visual grid snapping guide
      ghost = document.createElement('div');
      ghost.className = 'drag-snap-ghost';
      ghost.style.gridColumn = `${widget.x} / span ${widget.w}`;
      ghost.style.gridRow = `${widget.y} / span ${widget.h}`;
      widgetGrid.appendChild(ghost);
    });

    titlebar.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      
      const gridRect = widgetGrid.getBoundingClientRect();
      const colWidth = gridRect.width / 12;
      const rowHeight = 140 + 20;

      // Temporary relative overlay movement
      card.style.position = 'absolute';
      card.style.width = `${card.offsetWidth}px`;
      card.style.height = `${card.offsetHeight}px`;
      card.style.left = `${initialX + dx}px`;
      card.style.top = `${initialY + dy}px`;

      // Live update grid snapping ghost card position
      const currentX = Math.max(1, Math.min(12 - widget.w + 1, Math.round((initialX + dx) / colWidth) + 1));
      const currentY = Math.max(1, Math.round((initialY + dy) / rowHeight) + 1);

      if (ghost) {
        ghost.style.gridColumn = `${currentX} / span ${widget.w}`;
        ghost.style.gridRow = `${currentY} / span ${widget.h}`;
      }

      drawPipelines();
    });

    titlebar.addEventListener('pointerup', (e) => {
      if (!isDragging) return;
      isDragging = false;
      card.classList.remove('dragging');
      card.releasePointerCapture(e.pointerId);

      if (ghost) {
        ghost.remove();
        ghost = null;
      }

      const gridRect = widgetGrid.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const colWidth = gridRect.width / 12;
      const rowHeight = 140 + 20; // height + gap

      // Snapping coordinates (1-indexed)
      const newX = Math.max(1, Math.min(12 - widget.w + 1, Math.round((cardRect.left - gridRect.left) / colWidth) + 1));
      const newY = Math.max(1, Math.round((cardRect.top - gridRect.top) / rowHeight) + 1);

      // Reset card layout parameters
      card.style.position = '';
      card.style.width = '';
      card.style.height = '';
      card.style.left = '';
      card.style.top = '';

      // Update widget state
      widget.x = newX;
      widget.y = newY;
      
      // Dynamic widget grid collision displacement
      resolveGridCollisions(widget);

      card.style.gridColumn = `${widget.x} / span ${widget.w}`;
      card.style.gridRow = `${widget.y} / span ${widget.h}`;

      console.log(`Widget ${widget.id} snapped to grid coordinates x:${widget.x}, y:${widget.y}`);
      drawPipelines();
    });
  }

  // --- Auto Grid Collision & Displacement Engine ---
  function resolveGridCollisions(draggedWidget) {
    let collision = true;
    while (collision) {
      collision = false;
      for (const widget of widgets) {
        if (widget.id === draggedWidget.id) continue;

        // Check if there is an overlap in grid coordinates
        const xOverlap = (draggedWidget.x < widget.x + widget.w) && (draggedWidget.x + draggedWidget.w > widget.x);
        const yOverlap = (draggedWidget.y < widget.y + widget.h) && (draggedWidget.y + draggedWidget.h > widget.y);

        if (xOverlap && yOverlap) {
          collision = true;
          // Displace the other widget down to clear space
          widget.y = draggedWidget.y + draggedWidget.h;
          
          // Re-render that widget's position
          const card = document.getElementById(`card-${widget.id}`);
          if (card) {
            card.style.gridRow = `${widget.y} / span ${widget.h}`;
          }

          // Recursively check if the displaced widget collides with others downstream
          resolveGridCollisions(widget);
          break;
        }
      }
    }
  }

  // --- Workspace Shared State Sync ---
  window.updateWorkspaceVariable = (widgetId, key, val) => {
    if (!window.__workspace_variables[widgetId]) {
      window.__workspace_variables[widgetId] = {};
    }
    window.__workspace_variables[widgetId][key] = val;
    console.log(`Synced workspace state [${widgetId}]:`, window.__workspace_variables[widgetId]);
    
    // Auto-update pipelines data display if needed
    // In a fully built application this could propagate data from outputs directly to inputs
  };

  // --- SVG Connection Links Rendering ---
  function drawPipelines() {
    // Clear old lines
    connectionSvg.innerHTML = '';

    const gridRect = widgetGrid.getBoundingClientRect();
    const canvasRect = connectionSvg.getBoundingClientRect();

    pipelines.forEach(pipe => {
      const sourceCard = document.getElementById(`card-${pipe.sourceId}`);
      const targetCard = document.getElementById(`card-${pipe.targetId}`);
      
      if (!sourceCard || !targetCard) return;

      const sourceHandle = sourceCard.querySelector('.node-handle.output');
      const targetHandle = targetCard.querySelector('.node-handle.input');

      if (!sourceHandle || !targetHandle) return;

      const sRect = sourceHandle.getBoundingClientRect();
      const tRect = targetHandle.getBoundingClientRect();

      // Relative coordinates
      const x1 = sRect.left - canvasRect.left + sRect.width / 2;
      const y1 = sRect.top - canvasRect.top + sRect.height / 2;
      const x2 = tRect.left - canvasRect.left + tRect.width / 2;
      const y2 = tRect.top - canvasRect.top + tRect.height / 2;

      // Draw Cubic Bezier curve
      const dx = Math.abs(x2 - x1) * 0.5;
      const pathData = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

      // Outer glow line
      const glowLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      glowLine.setAttribute('d', pathData);
      glowLine.setAttribute('class', 'pipe-line-glow');

      // Intersecting dotted stream line
      const flowLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      flowLine.setAttribute('d', pathData);
      flowLine.setAttribute('class', 'pipe-line');

      connectionSvg.appendChild(glowLine);
      connectionSvg.appendChild(flowLine);
    });
  }

  // Draw lines on scroll/resize
  window.addEventListener('resize', drawPipelines);
  widgetGrid.addEventListener('scroll', drawPipelines);

  // --- GUI Core Operations (System level tools called by LLM) ---

  function createWidget(id, title, html, css, js, width = 4, height = 2) {
    if (widgets.some(w => w.id === id)) {
      console.warn(`Widget with id "${id}" already exists. Redirecting to update.`);
      updateWidget(id, title, html, css, js);
      return { status: 'updated', id };
    }

    const { x, y } = findEmptyGridSlot(width, height);
    const newWidget = { id, title, html, css, js, x, y, w: width, h: height };
    widgets.push(newWidget);
    createWidgetCard(newWidget);
    
    addSystemMessage(`Created Widget: "${title}" (${width}x${height} grid)`);
    return { status: 'success', message: `Widget "${title}" created at grid position x:${x}, y:${y}` };
  }

  function updateWidget(id, title, html, css, js) {
    const index = widgets.findIndex(w => w.id === id);
    if (index === -1) {
      return { status: 'error', error: `Widget "${id}" not found.` };
    }

    const oldWidget = widgets[index];
    const updated = {
      ...oldWidget,
      title: title || oldWidget.title,
      html: html !== undefined ? html : oldWidget.html,
      css: css !== undefined ? css : oldWidget.css,
      js: js !== undefined ? js : oldWidget.js
    };

    widgets[index] = updated;

    // Delete existing card DOM and redraw
    const oldCard = document.getElementById(`card-${id}`);
    if (oldCard) oldCard.remove();
    
    // Clean up WebMCP tools that were registered by the old frame
    // We expect the new script load to re-register active tools
    Array.from(window.__webmcp_tools.keys()).forEach(name => {
      // Typically widgets prepend or expose specific naming schemes, or write them natively
      // For this prototype, we'll let the polyfill handle unregisters when required
    });

    createWidgetCard(updated);
    addSystemMessage(`Updated Widget: "${updated.title}"`);
    return { status: 'success', message: `Widget "${id}" was successfully updated.` };
  }

  function deleteWidget(id) {
    const index = widgets.findIndex(w => w.id === id);
    if (index === -1) return { status: 'error', error: `Widget "${id}" not found.` };

    const title = widgets[index].title;
    widgets.splice(index, 1);

    const card = document.getElementById(`card-${id}`);
    if (card) card.remove();

    // Disconnect pipelines involving this widget
    pipelines = pipelines.filter(pipe => pipe.sourceId !== id && pipe.targetId !== id);
    
    // Unregister WebMCP tools associated with this widget
    // Dynamic tools registry updates
    updatePipelinesList();
    drawPipelines();
    
    addSystemMessage(`Removed Widget: "${title}"`);
    return { status: 'success', message: `Widget "${id}" removed from workspace.` };
  }

  function connectWidgets(sourceId, targetId, label) {
    if (pipelines.some(p => p.sourceId === sourceId && p.targetId === targetId)) {
      return { status: 'already_connected', message: 'Data link already exists between these widgets' };
    }

    pipelines.push({ sourceId, targetId, label });
    updatePipelinesList();
    drawPipelines();

    addSystemMessage(`Established Link: [${sourceId}] ➜ [${targetId}] ("${label}")`);
    return { status: 'success', message: `Linked ${sourceId} to ${targetId} successfully.` };
  }

  function disconnectWidgets(sourceId, targetId) {
    const len = pipelines.length;
    pipelines = pipelines.filter(p => !(p.sourceId === sourceId && p.targetId === targetId));
    
    if (pipelines.length < len) {
      updatePipelinesList();
      drawPipelines();
      addSystemMessage(`Removed Link: [${sourceId}] ➜ [${targetId}]`);
      return { status: 'success', message: `Unlinked ${sourceId} from ${targetId}.` };
    }
    return { status: 'not_found', message: 'No link exists between these widgets' };
  }

  // --- Shadow Workspace Layout (Proposed changes) ---
  function rearrangeWorkspace(layouts) {
    // Save layouts as a pending state first to demonstrate the "Shadow Canvas State Preview"
    pendingLayoutProposal = layouts;
    
    // Enable timeline toggle and commit button in footer
    timelineToggle.classList.remove('disabled');
    timelineToggle.querySelectorAll('.seg-btn').forEach(btn => {
      btn.removeAttribute('disabled');
      if (btn.dataset.val === '1') btn.classList.add('active');
      else btn.classList.remove('active');
    });

    timelineStatus.innerHTML = 'AI PROPOSAL PREVIEW';
    timelineStatus.style.color = 'var(--accent-rose)';
    commitPreviewBtn.classList.remove('disabled');

    // Show visual outlines (ghost rectangles) on the canvas to represent proposed state
    renderGhostOutlines(layouts);
    
    // Dim live cards during preview
    document.querySelectorAll('.widget-card').forEach(card => card.style.opacity = '0.3');
    
    addSystemMessage('AI Core proposed a new workspace layout. Toggle between "Live" and "AI Proposal" in the footer to review, then click "Commit Changes".');
    return { status: 'preview', message: 'Layout changes pending review' };
  }

  function renderGhostOutlines(layouts) {
    // Clear old ghost elements
    document.querySelectorAll('.ghost-card').forEach(g => g.remove());

    const gridRect = widgetGrid.getBoundingClientRect();

    layouts.forEach(layout => {
      const widget = widgets.find(w => w.id === layout.id);
      if (!widget) return;

      const ghost = document.createElement('div');
      ghost.className = 'ghost-card';
      ghost.style.position = 'absolute';
      ghost.style.gridColumn = `${layout.x || widget.x} / span ${layout.w || widget.w}`;
      ghost.style.gridRow = `${layout.y || widget.y} / span ${layout.h || widget.h}`;
      ghost.style.border = '2px dashed var(--accent-rose)';
      ghost.style.borderRadius = '12px';
      ghost.style.background = 'rgba(244, 63, 94, 0.04)';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '1';
      ghost.innerHTML = `<span style="font-size:10px; color:var(--accent-rose); padding:8px; display:block; font-family:monospace;">PROPOSED: ${widget.title}</span>`;
      
      widgetGrid.appendChild(ghost);
    });
  }

  // Timeline Toggle Button Click Handler
  timelineToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn || btn.hasAttribute('disabled')) return;

    // Toggle active class
    timelineToggle.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const val = btn.dataset.val;
    if (val === '0') {
      // Show live state
      timelineStatus.innerHTML = 'LIVE WORKSPACE';
      timelineStatus.style.color = 'var(--text-secondary)';
      document.querySelectorAll('.widget-card').forEach(card => card.style.opacity = '1');
      document.querySelectorAll('.ghost-card').forEach(ghost => ghost.style.opacity = '0.1');
    } else {
      // Preview proposed state
      timelineStatus.innerHTML = 'AI PROPOSAL PREVIEW';
      timelineStatus.style.color = 'var(--accent-rose)';
      document.querySelectorAll('.widget-card').forEach(card => card.style.opacity = '0.3');
      document.querySelectorAll('.ghost-card').forEach(ghost => ghost.style.opacity = '1');
    }
  });

  commitPreviewBtn.addEventListener('click', () => {
    if (!pendingLayoutProposal) return;

    // Apply proposed layouts to widgets state
    pendingLayoutProposal.forEach(layout => {
      const widget = widgets.find(w => w.id === layout.id);
      if (!widget) return;

      if (layout.x) widget.x = layout.x;
      if (layout.y) widget.y = layout.y;
      if (layout.w) widget.w = layout.w;
      if (layout.h) widget.h = layout.h;

      // Update actual DOM elements
      const card = document.getElementById(`card-${layout.id}`);
      if (card) {
        card.style.gridColumn = `${widget.x} / span ${widget.w}`;
        card.style.gridRow = `${widget.y} / span ${widget.h}`;
      }
    });

    // Clean up preview states
    document.querySelectorAll('.ghost-card').forEach(g => g.remove());
    document.querySelectorAll('.widget-card').forEach(card => card.style.opacity = '1');

    pendingLayoutProposal = null;

    // Reset timeline toggle
    timelineToggle.classList.add('disabled');
    timelineToggle.querySelectorAll('.seg-btn').forEach(btn => {
      btn.setAttribute('disabled', 'true');
      if (btn.dataset.val === '0') btn.classList.add('active');
      else btn.classList.remove('active');
    });

    timelineStatus.innerHTML = 'LIVE WORKSPACE';
    timelineStatus.style.color = 'var(--text-secondary)';
    commitPreviewBtn.classList.add('disabled');

    drawPipelines();
    addSystemMessage('Layout changes committed successfully.');
  });

  // --- Local Agent Tool Execution Loop ---
  async function executeTool(name, args) {
    console.log(`WebMCP: Executing tool "${name}" with args:`, args);
    
    // 1. Resolve System core layout tools
    if (name === 'create_widget') {
      return createWidget(args.id, args.title, args.html, args.css, args.js, args.width, args.height);
    }
    if (name === 'update_widget') {
      return updateWidget(args.id, args.title, args.html, args.css, args.js);
    }
    if (name === 'delete_widget') {
      return deleteWidget(args.id);
    }
    if (name === 'connect_widgets') {
      return connectWidgets(args.source_id, args.target_id, args.label);
    }
    if (name === 'disconnect_widgets') {
      return disconnectWidgets(args.source_id, args.target_id);
    }
    if (name === 'rearrange_workspace') {
      return rearrangeWorkspace(args.layouts);
    }

    // 2. Resolve Client-Registered WebMCP tools (imperative or form-based)
    const clientTool = window.__webmcp_tools.get(name);
    if (clientTool) {
      try {
        const result = await clientTool.execute(args);
        return { status: 'success', result };
      } catch (err) {
        return { status: 'error', error: err.message };
      }
    }

    return { status: 'error', error: `Tool "${name}" is not registered on this client.` };
  }

  // --- Chat console message rendering ---
  function addMessage(role, text) {
    const msg = document.createElement('div');
    msg.className = `message ${role}`;
    
    const content = document.createElement('div');
    content.className = 'message-content';
    // Basic formatting (replace newlines)
    content.innerHTML = text.replace(/\n/g, '<br>');
    
    msg.appendChild(content);
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function addSystemMessage(text) {
    const msg = document.createElement('div');
    msg.className = 'message system';
    msg.innerHTML = `<strong>System:</strong> ${text}`;
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // --- Sidebar Info Panels Synchronization ---
  function updateToolsList() {
    toolList.innerHTML = '';
    const size = window.__webmcp_tools.size;
    toolsCount.innerHTML = `${size} ACTIVE`;

    if (size === 0) {
      toolList.innerHTML = '<p class="empty-state">No client-side tools registered. Create widgets to dynamically expose WebMCP tools!</p>';
      return;
    }

    window.__webmcp_tools.forEach(tool => {
      const item = document.createElement('div');
      item.className = 'tool-item';
      
      const properties = Object.keys(tool.inputSchema.properties || {}).join(', ') || 'none';

      item.innerHTML = `
        <div class="tool-item-header">
          <span class="tool-name">${tool.name}</span>
          <span class="tool-type">WebMCP</span>
        </div>
        <div class="tool-description">${tool.description || 'No description provided.'}</div>
        <div class="tool-description" style="color:var(--text-muted); font-size:9px; margin-top:2px;">Args: {${properties}}</div>
      `;
      toolList.appendChild(item);
    });
  }

  function updatePipelinesList() {
    pipelineList.innerHTML = '';
    const size = pipelines.length;
    pipelinesCount.innerHTML = `${size} LINKS`;

    if (size === 0) {
      pipelineList.innerHTML = '<p class="empty-state">No widgets connected. Snapping widgets close or asking the AI will establish data bridges.</p>';
      return;
    }

    pipelines.forEach(pipe => {
      const item = document.createElement('div');
      item.className = 'pipeline-item';
      
      item.innerHTML = `
        <div class="pipeline-nodes">
          <span class="node-name">${pipe.sourceId}</span>
          <span class="pipeline-arrow">➜</span>
          <span class="node-name">${pipe.targetId}</span>
        </div>
        <span class="pipeline-label">${pipe.label}</span>
      `;
      pipelineList.appendChild(item);
    });
  }

  // Listen to WebMCP tool registrations to update list in sidebar
  window.addEventListener('webmcp-tool-registered', () => {
    updateToolsList();
  });
  
  window.addEventListener('webmcp-tool-unregistered', () => {
    updateToolsList();
  });

  // --- Chat Submit Core Engine ---
  async function handleSend() {
    const text = chatInput.value.trim();
    if (!text) return;

    if (!geminiApiKey) {
      alert('Please setup your Gemini API Key in the panel above first!');
      return;
    }

    chatInput.value = '';
    addMessage('user', text);
    
    // Append to Gemini API parts structure
    chatHistory.push({ role: 'user', parts: [{ text }] });

    await runChatCycle();
  }

  async function runChatCycle() {
    agentStatus.innerHTML = 'THINKING';
    agentStatus.className = 'agent-activity-status thinking';

    // 1. Gather all client tools currently registered
    const clientTools = Array.from(window.__webmcp_tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-api-key': geminiApiKey
        },
        body: JSON.stringify({
          messages: chatHistory,
          clientTools,
          workspaceState: window.__workspace_variables
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Server error communicating with Gemini');
      }

      const data = await response.json();
      
      // Store raw model candidate content parts in history to preserve thought signatures
      const historyItem = { role: 'model', parts: data.parts || [] };
      chatHistory.push(historyItem);

      // Extract and display text content
      const textPart = data.parts ? data.parts.find(p => p.text) : null;
      if (textPart && textPart.text) {
        addMessage('model', textPart.text);
      }

      // Extract function calls from raw response parts
      const calls = data.parts ? data.parts.filter(p => p.functionCall).map(p => ({
        name: p.functionCall.name,
        args: p.functionCall.args,
        id: p.functionCall.id || Math.random().toString(36).substring(7)
      })) : [];

      // Handle function tool calls
      if (calls.length > 0) {
        // Execute all tools sequentially
        const responseParts = [];
        for (const call of calls) {
          addSystemMessage(`AI calling tool: <code>${call.name}</code>...`);
          
          const result = await executeTool(call.name, call.args);
          
          responseParts.push({
            functionResponse: {
              name: call.name,
              response: result
            }
          });
        }

        // Add tool execution results to history as user turn
        chatHistory.push({
          role: 'user',
          parts: responseParts
        });

        // Trigger automatic cycle recurrence to let Gemini see the results
        await runChatCycle();

      } else {
        // No function calls, we are done
        agentStatus.innerHTML = 'IDLE';
        agentStatus.className = 'agent-activity-status';
      }

    } catch (error) {
      console.error(error);
      addSystemMessage(`Error: ${error.message}`);
      agentStatus.innerHTML = 'ERROR';
      agentStatus.className = 'agent-activity-status';
    }
  }

  // Wire UI Events
  chatSendBtn.addEventListener('click', handleSend);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Preset button prompts mapping
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      chatInput.value = btn.dataset.prompt;
      handleSend();
    });
  });

  clearCanvasBtn.addEventListener('click', () => {
    if (confirm('Clear entire workspace and remove all widgets?')) {
      widgets = [];
      pipelines = [];
      window.__workspace_variables = {};
      
      // Clear DOM
      widgetGrid.innerHTML = '';
      
      // Unregister tools (leaving polyfill intact)
      window.__webmcp_tools.clear();
      
      updateToolsList();
      updatePipelinesList();
      drawPipelines();
      
      chatHistory = [];
      chatMessages.innerHTML = '';
      addSystemMessage('Workspace reset. Operator ready.');
    }
  });

  // Onboarding Help Guide Widget HTML/CSS/JS definitions
  const guideHtml = `
    <div class="guide-wrapper">
      <p style="margin-bottom:12px; color:var(--text-secondary); font-size:11px;">
        Welcome to the <strong>Fluid OS</strong> playground. This canvas integrates a visual grid with live Gemini 3.5 Flash capabilities.
      </p>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <div>
          <strong style="color:var(--accent-cyan)">1. Drag & Snapping Grid</strong>
          <p style="color:var(--text-muted); font-size:10px; margin-left:12px;">
            Drag widgets by their grip handle <span style="color:var(--accent-cyan)">⋮⋮</span> to relocate. Snapping guides show drop locations, and overlapping cards are pushed down automatically.
          </p>
        </div>
        <div>
          <strong style="color:var(--accent-rose)">2. Shadow Preview Toggle</strong>
          <p style="color:var(--text-muted); font-size:10px; margin-left:12px;">
            Layout requests from the AI create a <em>Proposed Preview</em>. Use the tabs in the footer to compare states, then click "Commit" to apply. Dragging is locked in preview mode.
          </p>
        </div>
        <div>
          <strong style="color:var(--accent-purple)">3. WebMCP Pipelines</strong>
          <p style="color:var(--text-muted); font-size:10px; margin-left:12px;">
            Connect widgets by dragging lines from a cyan output circle to a purple input circle, or instruct the AI to build linkages.
          </p>
        </div>
      </div>
    </div>
  `;

  const guideCss = `
    .guide-wrapper { font-size: 11.5px; line-height: 1.4; color: var(--text-primary); }
  `;

  const guideJs = `
    console.log("Guide widget running successfully");
  `;

  // Spawn guide on first load
  createWidget('workspace-guide', 'Quickstart Guide', guideHtml, guideCss, guideJs, 5, 3);

  // Help Button click listener
  helpBtn.addEventListener('click', () => {
    if (widgets.some(w => w.id === 'workspace-guide')) {
      const card = document.getElementById('card-workspace-guide');
      if (card) {
        card.style.animation = 'none';
        card.offsetHeight; // force reflow
        card.style.animation = 'pulse-glow 1s ease';
        addSystemMessage("Quickstart Guide highlighted.");
      }
    } else {
      createWidget('workspace-guide', 'Quickstart Guide', guideHtml, guideCss, guideJs, 5, 3);
    }
  });

  // Run initial drawing
  requestAnimationFrame(drawPipelines);
});
