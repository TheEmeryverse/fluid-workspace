import express from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Core System Workspace tools that the backend always registers.
// These tools allow the Gemini model to control the overall GUI canvas layout and structure.
const systemTools = [
  {
    name: 'create_widget',
    description: 'Spawns a new interactive widget on the workspace canvas. The widget contains its own HTML, CSS, and JS code. It can register its own WebMCP tools using navigator.modelContext.registerTool inside its script.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'Unique slug identifier for the widget (e.g., "todo-list", "weather-tracker")' },
        title: { type: 'STRING', description: 'Friendly visual title for the widget header' },
        html: { type: 'STRING', description: 'The inner HTML content of the widget. Do not write full html/head tags, just body contents. Can use standard HTML elements.' },
        css: { type: 'STRING', description: 'Custom CSS styles scoped to this widget. Use elegant modern styling (e.g., custom properties, grid/flex, glassmorphism).' },
        js: { type: 'STRING', description: 'JavaScript logic for the widget. It runs inside a sandbox, can listen to DOM events, modify inner DOM elements, and call navigator.modelContext.registerTool({name, description, inputSchema, execute}) to expose its own actions back to the LLM.' },
        width: { type: 'INTEGER', description: 'Width in grid columns (1 to 12). Default is 4.' },
        height: { type: 'INTEGER', description: 'Height in grid row units (1 to 6). Default is 2.' }
      },
      required: ['id', 'title', 'html']
    }
  },
  {
    name: 'update_widget',
    description: 'Modifies an existing widget on the canvas. Updates its HTML structure, styles, and script logic.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'ID of the widget to update' },
        title: { type: 'STRING', description: 'Optional new title for the widget' },
        html: { type: 'STRING', description: 'Optional updated HTML content' },
        css: { type: 'STRING', description: 'Optional updated CSS' },
        js: { type: 'STRING', description: 'Optional updated JS logic' }
      },
      required: ['id']
    }
  },
  {
    name: 'delete_widget',
    description: 'Removes a widget from the workspace canvas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'ID of the widget to remove' }
      },
      required: ['id']
    }
  },
  {
    name: 'connect_widgets',
    description: 'Creates a visual link (SVG data line) connecting two widgets, symbolizing data flow or automation syncing.',
    parameters: {
      type: 'OBJECT',
      properties: {
        source_id: { type: 'STRING', description: 'ID of the source/emitter widget' },
        target_id: { type: 'STRING', description: 'ID of the target/receiver widget' },
        label: { type: 'STRING', description: 'Description of the data flowing, e.g., "Schedule deadlined items", "Sync weather location"' }
      },
      required: ['source_id', 'target_id', 'label']
    }
  },
  {
    name: 'disconnect_widgets',
    description: 'Removes a visual and logical link between two connected widgets.',
    parameters: {
      type: 'OBJECT',
      properties: {
        source_id: { type: 'STRING', description: 'ID of the source widget' },
        target_id: { type: 'STRING', description: 'ID of the target widget' }
      },
      required: ['source_id', 'target_id']
    }
  },
  {
    name: 'rearrange_workspace',
    description: 'Reorganizes the grid layout parameters of multiple widgets on the canvas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        layouts: {
          type: 'ARRAY',
          description: 'List of layout placements for widgets',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'ID of the widget' },
              x: { type: 'INTEGER', description: 'Grid column start position (1-12)' },
              y: { type: 'INTEGER', description: 'Grid row start position (1-100)' },
              w: { type: 'INTEGER', description: 'Width in columns (1-12)' },
              h: { type: 'INTEGER', description: 'Height in rows (1-6)' }
            },
            required: ['id']
          }
        }
      },
      required: ['layouts']
    }
  }
];

const systemInstruction = `You are the Workspace AI Core, the agentic operating system of a next-generation visual dashboard. 
You communicate with the user via text, but you also have full control over the visual workspace.
You can create, modify, rearrange, and connect interactive "widgets" on a 12-column grid canvas.

A widget is an isolated, dynamic micro-application. When you create or update widgets, write complete, modern, high-fidelity HTML, CSS, and JS.
Make widgets feel premium:
- Use HSL-tailored colors, smooth CSS animations, flexbox or grid layouts.
- Style them with glassmorphism backgrounds (.widget-card or custom selectors using modern backdrop-filter).
- Ensure interactive inputs (buttons, forms) use high-quality transitions.
- The JavaScript should register tools via navigator.modelContext.registerTool if the widget needs agentic control (e.g. a checklist widget registering "add_todo").
- If the user wants widgets to talk to each other, you can call connect_widgets to link them. Explain what automation sync logic occurs when they snap together.

When the user gives a request:
1. Call system tools (create_widget, update_widget, connect_widgets, rearrange_workspace) to build or alter the UI contextually.
2. Call widget-specific tools (which the user browser registers and sends to you in clientTools) to interact with data inside active widgets (e.g., adding an item, running search).
3. Provide a concise chat explanation of what you did. Avoid verbose paragraphs. Highlight the visual changes.
`;

app.post('/api/chat', async (req, res) => {
  const { messages, clientTools = [], apiKey: clientApiKey } = req.body;

  // Use API key from request header, request body, or environment variables
  const apiKey = clientApiKey || req.headers['x-gemini-api-key'] || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(401).json({ 
      error: 'GEMINI_API_KEY is missing. Please provide it in the server .env or set it in the client interface.' 
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Construct the tools array for Gemini: system workspace tools + active client-registered tools
    const declarations = [...systemTools];

    if (clientTools && clientTools.length > 0) {
      clientTools.forEach(tool => {
        // Map WebMCP client tools directly to Gemini declarations
        // Ensure they have the correct parameter formatting
        declarations.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema || { type: 'OBJECT', properties: {} }
        });
      });
    }

    // Call the Gemini 3.5 Flash model
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: messages,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: declarations }]
      }
    });

    // Check if Gemini wants to call functions
    const functionCalls = response.functionCalls || [];

    // Return the raw candidate content parts directly to the client
    // This preserves critical API metadata (like thought signatures) for recursive execution
    res.json({
      parts: response.candidates?.[0]?.content?.parts || []
    });

  } catch (error) {
    console.error('Gemini API Error:', error);
    res.status(500).json({ error: error.message || 'An error occurred while communicating with Gemini API.' });
  }
});

app.listen(PORT, () => {
  console.log(`Fluid Workspace running locally at http://localhost:${PORT}`);
});
