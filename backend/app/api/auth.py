import os
from fastapi import Request, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import create_client, Client
from app.config import settings

security = HTTPBearer()

# Initialize Supabase client
if not settings.supabase_url or not settings.supabase_key:
    supabase: Client = None
else:
    supabase: Client = create_client(settings.supabase_url, settings.supabase_key)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    """
    Dependency to get the current authenticated user from Supabase.
    Extracts the JWT from the Bearer token and verifies it.
    """
    token = credentials.credentials
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured in backend.")
        
    try:
        # get_user verifies the JWT against Supabase Auth
        res = supabase.auth.get_user(token)
        if not res.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        # Upsert user into DB if they don't exist yet (for foreign key constraints)
        from app.core.db import db_store
        db_store.get_or_create_user(res.user.email, res.user.id)
        
        return res.user.id
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")
