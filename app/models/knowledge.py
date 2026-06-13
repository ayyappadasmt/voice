from pydantic import BaseModel, Field
from typing import Optional
import uuid
from datetime import datetime

class KnowledgeChunk(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    content: str
    category: Optional[str] = "general"
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())

class KnowledgeChunkCreate(BaseModel):
    title: str
    content: str
    category: Optional[str] = "general"

class KnowledgeChunkUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None

class KnowledgeBase(BaseModel):
    chunks: list[KnowledgeChunk] = []