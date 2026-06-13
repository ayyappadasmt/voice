from fastapi import APIRouter, HTTPException
from app.models.knowledge import KnowledgeChunk, KnowledgeChunkCreate, KnowledgeChunkUpdate
from app.services import rag_service

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.get("/", response_model=list[KnowledgeChunk])
def list_chunks():
    return rag_service.get_all_chunks()


@router.post("/", response_model=KnowledgeChunk, status_code=201)
def create_chunk(data: KnowledgeChunkCreate):
    return rag_service.add_chunk(data)


@router.put("/{chunk_id}", response_model=KnowledgeChunk)
def update_chunk(chunk_id: str, data: KnowledgeChunkUpdate):
    chunk = rag_service.update_chunk(chunk_id, data)
    if not chunk:
        raise HTTPException(status_code=404, detail="Chunk not found")
    return chunk


@router.delete("/{chunk_id}")
def delete_chunk(chunk_id: str):
    if not rag_service.delete_chunk(chunk_id):
        raise HTTPException(status_code=404, detail="Chunk not found")
    return {"deleted": True}