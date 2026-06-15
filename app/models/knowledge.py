import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class KnowledgeChunk(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=10000)
    category: Optional[str] = Field(default="general", max_length=100)
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)


class KnowledgeChunkCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=10000)
    category: Optional[str] = Field(default="general", max_length=100)


class KnowledgeChunkUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    content: Optional[str] = Field(default=None, min_length=1, max_length=10000)
    category: Optional[str] = Field(default=None, max_length=100)


class KnowledgeBase(BaseModel):
    chunks: list[KnowledgeChunk] = []
