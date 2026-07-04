import sys
import os

# Add the backend directory to sys.path so we can import app modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.db import db

if not db:
    print("No DB connection.")
    sys.exit(1)

# Fetch all sessions with title "New Chat"
res = db.table("sessions").select("id").eq("title", "New Chat").execute()
sessions = res.data
print(f"Found {len(sessions)} sessions with title 'New Chat'")

for s in sessions:
    sid = s["id"]
    # Get the first user message
    msg_res = db.table("messages").select("content").eq("session_id", sid).eq("role", "user").order("created_at", desc=False).limit(1).execute()
    if msg_res.data:
        content = msg_res.data[0]["content"]
        new_title = content[:50] + ("..." if len(content) > 50 else "")
        db.table("sessions").update({"title": new_title}).eq("id", sid).execute()
    else:
        print(f"Session {sid} has no user messages, skipping.")

print("Done.")
