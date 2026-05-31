# 🌌 Fluid Workspace (Agentic GUI OS)

Fluid Workspace is an interactive, high-fidelity dashboard prototype demonstrating advanced concepts of **LLM-to-GUI integration**. Instead of static panels or text-only chat sessions, Fluid Workspace turns the LLM into a spatial operating system controller that dynamically structures, morphs, and automates your visual workspace.

Built with Node.js/Express, the official `@google/genai` SDK, and a custom browser polyfill for the **WebMCP (Web Model Context Protocol)**, it allows a **Gemini 3.5 Flash** backend to interact directly with front-end UI widgets.

---

## ✨ Key Architectural Concepts

### 1. Fluidic UI (Self-Assembling Widgets)
Rather than selecting from a static catalog of predefined blocks, the AI Core writes and compiles micro-applications (isolated HTML/CSS/JS) on the fly. 
*   **Safety Isolation**: Dynamic widgets are rendered inside sandboxed `<iframe>` containers to prevent external scripts from leaking styles or crashing the dashboard thread.

### 2. WebMCP Imperative & Declarative Polyfill
Exposes browser-side and widget-side functionality as tools that the backend Gemini model can call.
*   **Imperative Registration**: Widgets can execute `navigator.modelContext.registerTool({ name, description, inputSchema, execute })` to expose custom JavaScript methods.
*   **Declarative Form Scanning**: Standard HTML `<form>` elements annotated with `toolname` are parsed automatically to synthesize JSON schemas for the agent.
*   **Bridge Loop**: When the LLM decides to call a widget-registered tool (e.g., `add_todo`), the backend forwards the call. The client executes it inside the widget's sandbox and returns the result to Gemini, completing the cognitive cycle.

### 3. Shadow State Layout Preview
To prevent jarring visual updates when the LLM reorganizes the screen, Fluid Workspace uses a split-state preview system:
*   A segmented timeline toggle control in the footer allows users to switch between **Live Workspace** and **AI Proposed Preview**.
*   Layout proposals display dashed ghost outline cards on the grid, locking down manual edits to prevent state desync until the changes are committed.

### 4. Drag & Snap Grid with Collision Displacement
*   **Snapping Ghost Guide**: Visual snapping outlines show exactly where cards will land while dragging.
*   **Recursive Displacement**: Dropping a card on top of an existing widget triggers a grid collision solver that recursively slides surrounding cards down, keeping the canvas organized.

### 5. Autofill-Safe Input Architecture
Bypasses aggressive credential manager scans (such as Apple Keychain) by decoupling input names, utilising placeholder status masking, and deploying dummy forms to isolate authorization controls.

---

## 🛠️ Technology Stack

*   **Backend**: Node.js, Express, `@google/genai` (Official Google Gen AI SDK), `dotenv`
*   **Frontend**: Vanilla HTML5, CSS3 (Glassmorphism, custom cybernetic themes, Flexbox & Grid layouts), Vanilla JavaScript (WebMCP polyfill, SVG pipeline drawing, grid snapping)

---

## 🚀 Getting Started

### 1. Prerequisites
Make sure you have Node.js (v18+) installed.

### 2. Installation
Clone the repository and install the dependencies:
```bash
git clone https://github.com/TheEmeryverse/fluid-workspace.git
cd fluid-workspace
npm install
```

### 3. Configure Gemini API Key
Create a `.env` file in the root directory:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```
*(Alternatively, you can paste and activate your key directly in the sidebar interface which will save it locally in your browser's `localStorage`)*

### 4. Launch the Workspace
Start the development server:
```bash
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 🔮 Presets to Try

1.  **Help Guide**: Click the **Help Guide** button in the header to spawn the visual onboarding guide card.
2.  **Generate a Tool**: Ask: *"Create a dynamic freelance invoice calculator widget with dev and design input fields."*
3.  **Expose WebMCP Tools**: Spawn a checklist widget. Focus on the **WebMCP Tool Registry** panel in the sidebar to see `add_todo` register. Ask: *"Add 'finish project pitch' to my checklist"* and observe the agent execute the client-side tool.
4.  **Spatial Pipelines**: Ask: *"Connect the calculator to the todo list so I can track task invoices."* A visual Bezier curve connection will be drawn between output and input handles.
5.  **Layout Proposals**: Ask: *"Rearrange widgets in a vertical split layout."* Toggle the **Shadow State Preview** control in the footer to review the proposed ghost outlines, and click **Commit Changes** to apply.
