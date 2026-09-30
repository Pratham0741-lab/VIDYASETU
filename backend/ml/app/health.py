from pathlib import Path
from fastapi import APIRouter
from app.config import settings

router = APIRouter(tags=["Health"])


def resolve_models_dir() -> Path:
    """The configured models directory (ML_MODELS_DIR) - no silent fallback."""
    return settings.models_path


@router.get("/health")
async def health_check():
    """
    Health check endpoint reporting service operational status and model readiness.

    Architecture Note on Models:
    - The 4 core processing engines (quality_gate, classifier, extractor, consistency_checker)
      are in-memory rule/algorithmic engines initialized directly in code without requiring external weight files.
    - 'modelsDirExists' and 'modelsPresent' verify the offline model assets directory (app/models)
      reserved for any optional external model weights or offline dictionary bundles.
    """
    models_dir = resolve_models_dir()
    models_dir_exists = models_dir.exists() and models_dir.is_dir()
    models_present = False
    if models_dir_exists:
        models_present = any(models_dir.iterdir())

    return {
        "status": "ok",
        "modelsDirExists": models_dir_exists,
        "modelsPresent": models_present,
        "models": {
            "quality_gate": "ready",
            "classifier": "ready",
            "extractor": "ready",
            "consistency_checker": "ready"
        },
        "environment": settings.environment
    }
