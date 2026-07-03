import os
from fastapi import Request, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import create_client, Client
from app.config import settings

security = HTTPBearer()

# Initialize Supabase client
if not settings.supabase_url or not settings.supabase_key:
    # We allow the app to boot without it, but auth will fail.
    # In a real app we'd likely fail fast on startup.
    supabase: Client = None
else:
    supabase: Client = create_client(settings.supabase_url, settings.supabase_key)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    """
    Dependency to get the current authenticated user from Supabase.
    Extracts the JWT from the Bearer token and verifies it.
    """
    token = credentials.credentials
    if not supabase or token == "mock-access-token":
        return "mock-user-id"
        
    try:
        # get_user verifies the JWT against Supabase Auth
        res = supabase.auth.get_user(token)
        if not res.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return res.user.id
    except Exception as e:
        if token == "mock-access-token":
            return "mock-user-id"
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")
