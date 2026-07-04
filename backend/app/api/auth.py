import os
from fastapi import Request, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import create_client, Client
from app.config import settings

security = HTTPBearer()

# Fixed placeholder UUID for the "mock-access-token" dev bypass below — the users.id
# column is UUID, so the literal string "mock-user-id" fails Postgres's uuid input check.
MOCK_USER_ID = "00000000-0000-0000-0000-000000000001"

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
    if not supabase or token == "mock-access-token":
        # Create a mock user in the DB to satisfy foreign keys
        from app.core.db import db_store
        db_store.get_or_create_user("guest@routegen.ai", MOCK_USER_ID)
        return MOCK_USER_ID
        
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
