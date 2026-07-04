"""
RouteGen AI — Postgres DB Store (Supabase via Service Key)
"""

import uuid
import time
import logging
from typing import Dict, List, Optional
from supabase import create_client, Client
from app.config import settings

logger = logging.getLogger(__name__)

# Use service key for DB operations to bypass RLS for administrative backend functions
_url = settings.supabase_url
_key = settings.supabase_service_key or settings.supabase_key

if _url and _key:
    db: Client = create_client(_url, _key)
else:
    db = None

class DBStore:
    def get_or_create_user(self, email: str, supabase_user_id: str) -> None:
        """Upsert the user into the users table."""
        if not db: return
        
        res = db.table("users").select("id").eq("id", supabase_user_id).execute()
        if not res.data:
            try:
                db.table("users").insert({
                    "id": supabase_user_id,
                    "email": email,
                }).execute()
            except Exception:
                pass 

    def create_session(self, user_id: str, title: str = "New Chat", session_id: Optional[str] = None) -> str:
        """Create a new session and return the ID."""
        if not db: return session_id or str(uuid.uuid4())
        
        sid = session_id or str(uuid.uuid4())
        db.table("sessions").insert({
            "id": sid,
            "user_id": user_id,
            "title": title
        }).execute()
        
        return sid

    def update_session_title(self, session_id: str, title: str) -> None:
        if not db: return
        db.table("sessions").update({"title": title, "updated_at": "now()"}).eq("id", session_id).execute()

    def append_message(self, session_id: str, role: str, content: str, model_used: str = None, tier: str = None, cost: float = 0.0, energy_joules: float = 0.0, energy_gco2e: float = 0.0) -> None:
        if not db: return
        # Persistence must never sink the request: if Supabase is unreachable or the
        # insert fails, log it and let the caller still return the response to the user.
        try:
            msg_id = str(uuid.uuid4())
            db.table("messages").insert({
                "id": msg_id,
                "session_id": session_id,
                "role": role,
                "content": content,
                "model_used": model_used,
                "tier": tier,
                "cost": cost
            }).execute()

            db.table("sessions").update({"updated_at": "now()"}).eq("id", session_id).execute()
        except Exception as e:
            logger.warning(f"append_message failed for session {session_id} (role={role}): {e}")

    def get_session_messages(self, session_id: str, user_id: str, n_recent: int = 0) -> List[Dict]:
        if not db: return []
        
        if not self.verify_session_owner(session_id, user_id):
            return []
            
        res = db.table("messages").select("*").eq("session_id", session_id).order("created_at", desc=False).execute()
        messages = res.data
        if n_recent > 0:
            return messages[-n_recent:]
        return messages

    def get_user_sessions(self, user_id: str) -> List[Dict]:
        if not db: return []
        res = db.table("sessions").select("*, messages(count)").eq("user_id", user_id).order("updated_at", desc=True).execute()
        sessions = res.data
        
        return [
            {
                "session_id": s["id"],
                "title": s["title"],
                "created_at": s["created_at"],
                "updated_at": s["updated_at"],
                "message_count": s["messages"][0]["count"] if s.get("messages") else 0,
            }
            for s in sessions
        ]

    def verify_session_owner(self, session_id: str, user_id: str) -> bool:
        if not db: return True
        res = db.table("sessions").select("id").eq("id", session_id).eq("user_id", user_id).execute()
        return len(res.data) > 0

    def get_session(self, session_id: str, user_id: str) -> Optional[Dict]:
        if not db: return None
        if not self.verify_session_owner(session_id, user_id):
            return None
            
        session_res = db.table("sessions").select("*").eq("id", session_id).execute()
        if not session_res.data:
            return None
            
        session_data = session_res.data[0]
        msg_res = db.table("messages").select("role, content, model_used, cost").eq("session_id", session_id).order("created_at", desc=False).execute()
        
        return {
            "session_id": session_data["id"],
            "title": session_data["title"],
            "created_at": session_data["created_at"],
            "messages": msg_res.data,
        }

    def get_user_metrics(self, user_id: str) -> Dict:
        if not db:
            return {
                "routegen_cost": 0.0,
                "routegen_joules": 0.0,
                "baseline_cost": 0.0,
                "baseline_joules": 0.0,
                "total_runs": 0,
                "total_savings_pct": 0.0,
                "energy_savings_pct": 0.0
            }
        
        # Get all sessions for this user
        sessions_res = db.table("sessions").select("id").eq("user_id", user_id).execute()
        session_ids = [s["id"] for s in sessions_res.data]
        
        if not session_ids:
            return {
                "routegen_cost": 0.0,
                "routegen_joules": 0.0,
                "baseline_cost": 0.0,
                "baseline_joules": 0.0,
                "total_runs": 0,
                "total_savings_pct": 0.0,
                "energy_savings_pct": 0.0
            }
            
        # Get all assistant messages for these sessions
        msgs_res = db.table("messages").select("cost").in_("session_id", session_ids).eq("role", "assistant").execute()
        messages = msgs_res.data
        
        total_runs = len(messages)
        routegen_cost = sum(m.get("cost", 0.0) or 0.0 for m in messages)
        
        # Calculate energy dynamically since we don't store it in the DB (approx 8000 Joules per $1 for small tier)
        routegen_joules = routegen_cost * 8000.0
        
        # Baseline estimate: flat $0.015 and 120 Joules per run
        baseline_cost = total_runs * 0.015
        baseline_joules = total_runs * 120.0
        
        cost_savings_pct = ((baseline_cost - routegen_cost) / baseline_cost * 100) if baseline_cost > 0 else 0.0
        energy_savings_pct = ((baseline_joules - routegen_joules) / baseline_joules * 100) if baseline_joules > 0 else 0.0
        
        return {
            "routegen_cost": routegen_cost,
            "routegen_joules": routegen_joules,
            "baseline_cost": baseline_cost,
            "baseline_joules": baseline_joules,
            "total_runs": total_runs,
            "total_savings_pct": max(0, cost_savings_pct),
            "energy_savings_pct": max(0, energy_savings_pct)
        }

db_store = DBStore()
