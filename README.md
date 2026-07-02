# RouteGen AI 🚀

> **Intelligent Model Routing for Cost Optimization**  
> *Built by Team Neural Nexus for HACKINDIA / MAKEATHON 3.0 (Track 03 - Intelligent Model Routing)*

RouteGen AI is an intelligent orchestration layer that dynamically routes Large Language Model (LLM) queries to the most cost-effective model tier based on prompt complexity, drastically reducing AI inference costs while maintaining high response quality.

---

## 🎯 Key Features

- **Complexity Classifier:** Machine learning classifier (Scikit-learn) that assigns a complexity score (1-10) to incoming prompts based on structure, constraints, and semantics.
- **Dynamic Routing:** Intelligently dispatches prompts across 3 tiers (Small, Large, Reasoning) via LiteLLM and RouteLLM to optimize cost and performance.
- **Semantic Caching:** Zero-cost inference for similar queries using Sentence-Transformers and Chroma DB (Similarity threshold: 0.95).
- **Auto-Fallback & Quality Assurance:** Typed output assertions via DSPy; automatically escalates to a higher model tier if the current model fails to meet the schema or quality constraints.
- **Real-Time Observability:** Dashboard visualizing live routing logs, cache hits, cost savings (USD), and CO2 impact, powered by Langfuse and Recharts.

---

## 🛠 Tech Stack

### Frontend
- **React.js 18** + **Tailwind CSS 3** (Web Portal & Dashboard)
- **Recharts** (Real-time visualizations)
- **Vite** (Build tool)

### Backend
- **Python 3.11** + **FastAPI**
- **PostgreSQL 16** (Routing logs & metadata)
- **MongoDB 7** (Raw trace & document store)
- **Redis 7** (Caching & Budget kill-switch)

### AI Orchestration
- **LangGraph** (State-machine pipeline orchestration)
- **LiteLLM** & **RouteLLM** (Unified model proxy & decision engine)
- **DSPy** (Prompt optimization & structural assertions)
- **Ollama** (Local inference for Small Tier)

---

## 🚀 Quick Start Instructions

Follow these steps to run the frontend and backend locally for development.

### 1. Prerequisites
- **Node.js** (v18+)
- **Python** (v3.11+)
- Ensure your required databases (Postgres, MongoDB, Redis, Chroma) are running locally or accessible via remote URIs.
- (Optional) [Ollama](https://ollama.com/) installed if you plan to use local models for the Small Tier.

### 2. Setup Environment Variables
Clone the repository and set up your environment variables:
```bash
git clone https://github.com/Harshini-SA/ROUTEGEN-AI.git
cd ROUTEGEN-AI

# Copy the example environment file
cp .env.example .env
```
**Important:** Open `.env` and fill in your actual API keys (e.g., `GROQ_API_KEY`, `GEMINI_API_KEY`) and database connection strings.

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
The API will now be accessible at `http://localhost:8000`.

### 4. Start the Frontend
Open a new terminal window, navigate to the `frontend` directory, install the Node dependencies, and start the Vite development server:
```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```
The frontend dashboard will now be accessible at the URL provided by Vite (typically `http://localhost:5173`).

### 5. Run a Demo Pipeline
You can trigger the pipeline manually via a simple cURL request to see the routing in action:
```bash
curl -X POST http://localhost:8000/pipeline/run \
     -H "Content-Type: application/json" \
     -d '{"query": "What is the current state of AI regulation in the EU?"}'
```
You'll immediately see the routing decision, model selected, cost, and cache stats reflected on your local dashboard!

---

## 🔒 Security
- All LLM API keys are managed securely via `.env`.
- Budget caps and rate limits are enforced server-side.
- Semantic cache embeddings are dense numerical representations and cannot be reverse-engineered into raw prompts.

## 📄 License
This project leverages various open-source technologies (MIT, Apache 2.0, BSD). See individual components for their respective licenses.
