AI Engineering Fundamentals

An AI-powered diagramming platform that converts natural language into editable diagrams. The application uses a Cloudflare Workers agent to control an Excalidraw canvas through structured tool calls, integrates web search and RAG for accurate information retrieval, and includes evaluation tooling for continuously improving agent performance.

Features
-Generate diagrams from natural language (e.g., "draw a sequence diagram for OAuth login")
-Create, update, and delete Excalidraw elements through AI tool calls
-Read and understand the current canvas state
-Search the web for up-to-date information
-Query a private knowledge base using RAG
-Stream AI responses in real time
-Display tool execution status
-Human approval workflow for sensitive actions
-Built-in evaluation framework for measuring and improving agent performance

Project Structure
src/
lessons/
data/
assets/


Documentation is available as Markdown files and can be viewed:
Setup
Clone the repository
git clone <repository-url>
cd intro-ai-engineering
npm install
Required Services


The application integrates with the following services:
Service	Purpose
OpenAI	AI model provider
Upstash Vector	Vector database for RAG
Braintrust	Evaluation and testing
Tavily	Web search
Environment Variables

Create a .dev.vars file in the project root.
OPENAI_API_KEY=sk-...
UPSTASH_VECTOR_REST_URL=https://...
UPSTASH_VECTOR_REST_TOKEN=...
BRAINTRUST_API_KEY=sk-...
TAVILY_API_KEY=tvly-...


Running the Project
npm run dev      # Start development server
npm run docs     # Launch documentation site
npm run embed    # Build vector index
npm run eval     # Run evaluation suite|

Tech Stack
Runtime: Node.js + Cloudflare Workers
Frontend: React + Vite + Excalidraw
AI Framework: AI SDK + Cloudflare Agents SDK
Vector Database: Upstash Vector
Evaluation: Braintrust
Search: Tavily

