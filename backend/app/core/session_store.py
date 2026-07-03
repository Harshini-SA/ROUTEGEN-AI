"""
RouteGen AI — Postgres Session Store (Supabase)

Stores per-session message history in Supabase Postgres.
"""

import uuid
import time
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from app.api.auth import supabase

@dataclass
class Session:
    session_id: str
    user_id: str
    title: str
    created_at: str
    messages: List[Dict[str, str]] = field(default_factory=list)


class SessionStore:
    """Supabase-backed conversation store with local in-memory fallback."""

    def __init__(self):
        # In-memory session store: user_id -> {session_id: Session}
        self._local_sessions: Dict[str, Dict[str, Session]] = {}

    def _get_local_sessions(self, user_id: str) -> Dict[str, Session]:
        if user_id not in self._local_sessions:
            self._local_sessions[user_id] = {}
        return self._local_sessions[user_id]

    def get_or_create(self, user_id: str, session_id: Optional[str] = None) -> Session:
        """Return an existing session or create a new one."""
        if not supabase:
            sessions = self._get_local_sessions(user_id)
            if session_id and session_id in sessions:
                return sessions[session_id]
            new_id = session_id or str(uuid.uuid4())
            new_session = Session(
                session_id=new_id,
                user_id=user_id,
                title="New Chat",
                created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                messages=[]
            )
            sessions[new_id] = new_session
            return new_session

        if session_id:
            res = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).execute()
            if res.data:
                # Return existing
                return Session(
                    session_id=res.data[0]["id"],
                    user_id=res.data[0]["user_id"],
                    title=res.data[0]["title"],
                    created_at=res.data[0]["created_at"]
                )

        new_id = session_id or str(uuid.uuid4())
        session_data = {
            "id": new_id,
            "user_id": user_id,
            "title": "New Chat",
        }
        res = supabase.table("sessions").insert(session_data).execute()
        data = res.data[0]
        return Session(
            session_id=data["id"],
            user_id=data["user_id"],
            title=data["title"],
            created_at=data["created_at"]
        )

    def append_message(self, user_id: str, session_id: str, role: str, content: str) -> None:
        """Append a message to a session. Auto-generates title from first user message."""
        if not supabase:
            sessions = self._get_local_sessions(user_id)
            if session_id not in sessions:
                return
            session = sessions[session_id]
            session.messages.append({"role": role, "content": content})
            if role == "user" and session.title == "New Chat":
                session.title = content[:60] + ("..." if len(content) > 60 else "")
            return

        # Verify session belongs to user
        session_res = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).execute()
        if not session_res.data:
            return

        session_data = session_res.data[0]

        # Insert message
        msg_id = str(uuid.uuid4())
        supabase.table("messages").insert({
            "id": msg_id,
            "session_id": session_id,
            "role": role,
            "content": content
        }).execute()

        # Auto-generate title from first user message
        if role == "user" and session_data["title"] == "New Chat":
            new_title = content[:60] + ("..." if len(content) > 60 else "")
            supabase.table("sessions").update({"title": new_title}).eq("id", session_id).execute()

    def get_recent_history(self, user_id: str, session_id: str, n: int = 10) -> List[Dict[str, str]]:
        """Return the last N messages for context injection."""
        if not supabase:
            sessions = self._get_local_sessions(user_id)
            if session_id not in sessions:
                return []
            messages = sessions[session_id].messages
            return messages[-n:] if messages else []

        session_res = supabase.table("sessions").select("id").eq("id", session_id).eq("user_id", user_id).execute()
        if not session_res.data:
            return []

        res = supabase.table("messages").select("role, content").eq("session_id", session_id).order("created_at", desc=False).execute()
        messages = res.data
        return messages[-n:] if messages else []

    def list_sessions(self, user_id: str) -> List[Dict]:
        """Return all sessions for a user sorted by most recent first."""
        if not supabase:
            sessions = self._get_local_sessions(user_id)
            # Sort by created_at desc or order of creation. Let's just sort by session ID or keep them ordered
            return [
                {
                    "session_id": s.session_id,
                    "title": s.title,
                    "created_at": s.created_at,
                    "message_count": len(s.messages),
                }
                for s in reversed(list(sessions.values()))
            ]

        res = supabase.table("sessions").select("*, messages(count)").eq("user_id", user_id).order("created_at", desc=True).execute()
        sessions = res.data
        
        return [
            {
                "session_id": s["id"],
                "title": s["title"],
                "created_at": s["created_at"],
                "message_count": s["messages"][0]["count"] if s.get("messages") else 0,
            }
            for s in sessions
        ]

    def get_session(self, user_id: str, session_id: str) -> Optional[Dict]:
        """Return full session data including messages."""
        if not supabase:
            sessions = self._get_local_sessions(user_id)
            if session_id not in sessions:
                return None
            s = sessions[session_id]
            return {
                "session_id": s.session_id,
                "title": s.title,
                "created_at": s.created_at,
                "messages": s.messages,
            }

        session_res = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).execute()
        if not session_res.data:
            return None
            
        session_data = session_res.data[0]
        
        msg_res = supabase.table("messages").select("role, content").eq("session_id", session_id).order("created_at", desc=False).execute()
        
        return {
            "session_id": session_data["id"],
            "title": session_data["title"],
            "created_at": session_data["created_at"],
            "messages": msg_res.data,
        }

# Singleton
session_store = SessionStore()
