// WebMCP Polyfill for Fluid Workspace
// Implements navigator.modelContext for tools registration and form-based declarative tools scanner.

(function() {
  // Registry for active client-side tools
  // Maps toolName -> { name, description, inputSchema, execute }
  window.__webmcp_tools = new Map();

  // Polyfill navigator.modelContext
  if (!navigator.modelContext) {
    navigator.modelContext = {
      registerTool(toolDef) {
        if (!toolDef || !toolDef.name) {
          console.error('WebMCP: Invalid tool definition', toolDef);
          return;
        }

        const normalizedTool = {
          name: toolDef.name,
          description: toolDef.description || '',
          inputSchema: toolDef.inputSchema || { type: 'object', properties: {} },
          execute: toolDef.execute || (() => {})
        };

        window.__webmcp_tools.set(normalizedTool.name, normalizedTool);
        console.log(`WebMCP: Registered imperative tool "${normalizedTool.name}"`);

        // Notify the main application that a tool was registered
        window.dispatchEvent(new CustomEvent('webmcp-tool-registered', {
          detail: { tool: normalizedTool }
        }));
      }
    };
  }

  // Scan the document or specific element for Declarative Form Tools
  function scanForms(container = document) {
    const forms = container.querySelectorAll('form[toolname]');
    
    forms.forEach(form => {
      const toolName = form.getAttribute('toolname');
      const toolDescription = form.getAttribute('tooldescription') || '';
      const autoSubmit = form.hasAttribute('toolautosubmit');
      
      // Prevent double registration
      if (window.__webmcp_tools.has(toolName)) return;

      const properties = {};
      const required = [];

      // Find form inputs to synthesize schema
      const inputs = form.querySelectorAll('input, select, textarea');
      inputs.forEach(input => {
        const name = input.getAttribute('name');
        if (!name) return;

        if (input.hasAttribute('required')) {
          required.push(name);
        }

        // Determine data type
        let type = 'string';
        const inputType = input.getAttribute('type');
        if (inputType === 'number' || inputType === 'range') {
          type = 'number';
        } else if (inputType === 'checkbox') {
          type = 'boolean';
        }

        // Resolve parameter description
        let description = input.getAttribute('toolparamdescription');
        if (!description) {
          // Fallback to associated label text (skipping child elements)
          if (input.id) {
            const label = form.querySelector(`label[for="${input.id}"]`);
            if (label) {
              description = Array.from(label.childNodes)
                .filter(node => node.nodeType === Node.TEXT_NODE)
                .map(node => node.textContent.trim())
                .join(' ');
            }
          }
          // Fallback to aria-description or name
          description = description || input.getAttribute('aria-description') || `The ${name} field`;
        }

        properties[name] = { type, description };
      });

      // Register the Declarative form as a tool
      navigator.modelContext.registerTool({
        name: toolName,
        description: toolDescription,
        inputSchema: {
          type: 'object',
          properties,
          required
        },
        execute(args) {
          return new Promise((resolve, reject) => {
            // 1. Populate values into the form
            inputs.forEach(input => {
              const name = input.getAttribute('name');
              if (name in args) {
                if (input.getAttribute('type') === 'checkbox') {
                  input.checked = !!args[name];
                } else {
                  input.value = args[name];
                }
                // Dispatch input events so standard handlers trigger
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
            });

            // 2. Visual indicators for active agent usage
            form.classList.add('tool-form-active');
            form.setAttribute('data-tool-active', 'true');
            
            const submitBtn = form.querySelector('[type="submit"]') || form.querySelector('button');
            if (submitBtn) {
              submitBtn.classList.add('tool-submit-active');
              submitBtn.setAttribute('data-tool-submit-active', 'true');
            }

            // 3. Dispatch SubmitEvent with Agent properties
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
            submitEvent.agentInvoked = true;
            
            let responsePromise = null;
            submitEvent.respondWith = (promise) => {
              responsePromise = promise;
            };

            // Notify window that tool was activated
            window.dispatchEvent(new CustomEvent('toolactivated', { detail: { toolName } }));

            // Dispatch form submit
            form.dispatchEvent(submitEvent);

            const cleanupVisuals = () => {
              form.classList.remove('tool-form-active');
              form.removeAttribute('data-tool-active');
              if (submitBtn) {
                submitBtn.classList.remove('tool-submit-active');
                submitBtn.removeAttribute('data-tool-submit-active');
              }
            };

            // 4. Resolve output
            if (responsePromise) {
              Promise.resolve(responsePromise)
                .then(result => {
                  cleanupVisuals();
                  resolve(result);
                })
                .catch(err => {
                  cleanupVisuals();
                  reject(err);
                });
            } else {
              // Standard auto-submit resolving
              cleanupVisuals();
              resolve(`Form "${toolName}" submitted successfully with: ${JSON.stringify(args)}`);
            }
          });
        }
      });
    });
  }

  // Handle postMessage channel for sandboxed iframes
  window.addEventListener('message', (event) => {
    // Basic verification: only accept messages with a specific format
    const { type, toolDef, toolName, args, result, error, requestId } = event.data || {};
    if (!type) return;

    if (type === 'webmcp-register') {
      // An iframe is registering a tool.
      // We wrap the execute call so it forwards back to the iframe.
      const iframeSource = event.source;

      navigator.modelContext.registerTool({
        name: toolDef.name,
        description: toolDef.description,
        inputSchema: toolDef.inputSchema,
        execute(inputArgs) {
          return new Promise((resolve, reject) => {
            const reqId = Math.random().toString(36).substring(7);
            
            // Map listener for this specific execution response
            const responseHandler = (e) => {
              if (e.data && e.data.type === 'webmcp-exec-response' && e.data.requestId === reqId) {
                window.removeEventListener('message', responseHandler);
                if (e.data.error) {
                  reject(new Error(e.data.error));
                } else {
                  resolve(e.data.result);
                }
              }
            };
            window.addEventListener('message', responseHandler);

            // Send request to the iframe script
            iframeSource.postMessage({
              type: 'webmcp-exec-request',
              toolName: toolDef.name,
              args: inputArgs,
              requestId: reqId
            }, '*');
          });
        }
      });
    }
  });

  // Export scanForms so app.js can call it when inserting widgets
  window.webmcp = {
    scanForms,
    unregisterTool(name) {
      window.__webmcp_tools.delete(name);
      window.dispatchEvent(new CustomEvent('webmcp-tool-unregistered', {
        detail: { name }
      }));
    }
  };

  // Run initial scan on load
  window.addEventListener('DOMContentLoaded', () => {
    scanForms();
  });
})();
