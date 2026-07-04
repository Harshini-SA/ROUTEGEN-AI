# RouteGen AI 🚀

> **Intelligent Model Routing for Cost Optimization**  
> *Built by Team Neural Nexus for HACKINDIA / MAKEATHON 3.0 (Track 03 - Intelligent Model Routing)*

RouteGen AI is an intelligent orchestration layer that dynamically routes Large Language Model (LLM) queries to the most cost-effective model tier based on prompt complexity, drastically reducing AI inference costs while maintaining high response quality.

---

## 🎯 Key Features

- **Complexity Classifier:** A heuristic classifier that assigns a complexity score (1–10) to each prompt from its structure, length, keywords, and constraints. Classification runs **once per query** and the chosen tier is locked for the entire pipeline, so a simple question is never silently upgraded to a premium model.
- **Dynamic 3-Tier Routing:** Dispatches prompts across **Small**, **Large**, and **Reasoning** tiers via LiteLLM, mapping complexity to the cheapest model that can handle the job.
- **Intra-Tier Fallback:** If a tier's primary provider fails (e.g. a `429` quota/rate-limit), RouteGen automatically retries a backup model **in the same tier** before escalating to a more expensive tier — and users always get a graceful response instead of a raw error.
- **RAG Document Q&A:** Upload PDF, PPTX, or image files and ask questions about them. Text is chunked, embedded locally (Sentence-Transformers `all-MiniLM-L6-v2`), and stored in an embedded ChromaDB scoped per session. Images use Tesseract OCR with an automatic **Gemini Vision** fallback.
- **Quality-vs-Cost Comparison Dashboard:** Benchmark smart routing against a single always-premium-model baseline on the same prompt, with **LLM-as-judge** scoring, real per-token cost, and side-by-side charts.
- **Real-Time Observability:** Live routing logs, per-node tier decisions, real cost (USD), and fallback badges streamed over WebSocket and visualized with Recharts.

---

## 🛠 Tech Stack

### Frontend
- **React 19** + **Tailwind CSS 4** (Web Portal & Dashboard)
- **Recharts** (Real-time visualizations)
- **Vite 8** (Build tool) · **TypeScript**
- **Supabase JS** (Auth & session data)

### Backend
- **Python 3.11+** (tested on 3.13) + **FastAPI**
- **LangGraph** (state-machine pipeline orchestration)
- **LiteLLM** (unified proxy + real token-based cost accounting across providers)
- **ChromaDB** (embedded) + **Sentence-Transformers** (RAG vector store & embeddings)
- **pypdf / python-pptx / Pillow / pytesseract** (multi-format file ingestion)
- **Supabase** (auth + conversation storage)

> **Optional services:** PostgreSQL, MongoDB, and Redis are supported but **not required** — the app boots and core routing works without them, logging a warning and skipping any unavailable service.

### Model Tiers
| Tier | Primary Model | Intra-Tier Fallback |
|------|---------------|---------------------|
| **Small** | `groq/llama-3.1-8b-instant` | `groq/llama-3.3-70b-versatile` |
| **Large** | `gemini/gemini-3.5-flash` | `groq/llama-3.3-70b-versatile` |
| **Reasoning** | `cerebras/gpt-oss-120b` | `groq/llama-3.3-70b-versatile` |

---

## 🚀 Quick Start Instructions

Follow these steps to run the frontend and backend locally for development.

### 1. Prerequisites
- **Node.js** (v18+)
- **Python** (v3.11+)
- **API keys** for [Groq](https://console.groq.com/), [Google Gemini](https://aistudio.google.com/), and [Cerebras](https://cloud.cerebras.ai/) (all offer free tiers).
- *(Optional)* [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki) for local image text extraction. If it's not installed, RouteGen automatically falls back to Gemini Vision — **no action needed**.
- *(Optional)* Postgres / MongoDB / Redis — only if you want persistent trace storage; the app runs fine without them.

### 2. Setup Environment Variables
Clone the repository and set up your environment variables:
```bash
git clone https://github.com/Harshini-SA/ROUTEGEN-AI.git
cd ROUTEGEN-AI

# Copy the example environment file
cp .env.example .env
```
**Important:** Open `.env` and fill in your actual keys. At minimum, for full routing you'll want:
```bash
GROQ_API_KEY=...
GEMINI_API_KEY=...
CEREBRAS_API_KEY=...

# Optional — enables real auth & persistent chat history.
# Without these, the backend runs in local mock-auth mode.
SUPABASE_URL=...
SUPABASE_KEY=...
```

### 3. Start the Backend
Navigate to the `backend` directory, install the Python dependencies, and start the FastAPI server:
```bash
cd backend
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the FastAPI server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
The API will now be accessible at `http://localhost:8000` (interactive docs at `http://localhost:8000/docs`).

> **First run note:** On startup, the RAG embedding model (`all-MiniLM-L6-v2`, ~90 MB) downloads once and is cached. Startup also probes the optional databases — if they aren't running you'll see harmless "unavailable (skipping)" warnings and the server continues normally.

### 4. Start the Frontend
Open a new terminal window, navigate to the `frontend` directory, install the Node dependencies, and start the Vite development server:
```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```
The frontend dashboard will be accessible at the URL Vite prints (typically `http://localhost:5173`, or `5174` if that port is already in use).

### 5. Try It Out
Trigger the routing pipeline directly with cURL (the `mock-access-token` bypasses auth for local testing):
```bash
curl -X POST http://localhost:8000/pipeline/run \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer mock-access-token" \
     -d '{"query": "What is the capital of France?", "session_id": "demo-1"}'
```
You'll get back the final response, total cost, and a per-node routing log showing the tier, model, and cost of each step.

---

## 📡 Key API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/pipeline/run` | Run a query through the routed pipeline (with conversation memory + RAG). |
| `POST` | `/compare` | Quality-vs-cost benchmark: routed vs. single-premium-model baseline, with LLM-as-judge scoring. |
| `POST` | `/upload` | Upload a PDF / PPTX / image (multipart) to index it for RAG in a session. |
| `GET` | `/documents/{session_id}` | List documents indexed for a session. |
| `DELETE` | `/documents/{session_id}` | Clear all documents for a session. |
| `GET` | `/sessions` · `/sessions/{id}` | List / fetch conversation sessions. |
| `WS` | `/ws/live` | WebSocket stream of live routing logs. |
| `GET` | `/health` | Health check. |

---

## 🔒 Security
- All LLM API keys are managed securely via `.env` (never committed).
- Budget caps and rate limits are enforced server-side.
- RAG document chunks are scoped per session; embeddings are dense numerical vectors that cannot be reverse-engineered into raw prompts.

## 📄 License
This project leverages various open-source technologies (MIT, Apache 2.0, BSD). See individual components for their respective licenses.
