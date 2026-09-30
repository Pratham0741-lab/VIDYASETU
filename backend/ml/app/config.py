from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8000
    environment: str = "production"
    log_level: str = "INFO"
    service_name: str = "vidyasetu-ml"

    # Model and offline asset paths
    models_dir: str = "app/models"

    # Quality Gate Thresholds
    blur_threshold: float = 100.0  # Minimum Laplacian variance for non-blurry
    min_width: int = 400          # Minimum width in pixels
    min_height: int = 400         # Minimum height in pixels
    glare_pixel_threshold: int = 245  # Paper brightness considered saturated (0-255)
    # Glare = saturated paper standing out ABOVE the page's own smooth shading by
    # at least this many grey levels (a flash/reflection hotspot) - not merely
    # bright paper: a clean white scan is saturated everywhere and is not glare.
    glare_excess_threshold: float = 8.0
    glare_ratio_threshold: float = 0.01  # Fraction of the page covered by hotspots before flagged
    # cut_off_edge = printed content crossing the image border (a crop), never
    # blank margins. Ink = at least this much darker than the local paper.
    ink_contrast_threshold: int = 60
    cut_off_min_runs: int = 2  # separate ink crossings of one border before a side counts as cut

    # Classification Thresholds
    classify_min_confidence: float = 0.40
    # Calibrated classification confidence (see classify_service.score_document_text):
    # only types with evidence compete, against a "none of these types" reference
    # at classify_evidence_floor points - the strongest evidence a WRONG type
    # picked up on the real calibration set (5.5; the correct type scored >= 8.0).
    # classify_temperature = points per e-fold of odds: 2.3 makes one primary
    # keyword (4 points) beyond the reference worth 85% (4 / ln(0.85/0.15)).
    classify_evidence_floor: float = 5.5
    classify_temperature: float = 2.3

    # Extraction Thresholds
    extract_min_field_confidence: float = 0.40

    # Consistency Thresholds
    name_similarity_threshold: float = 0.70

    # Every setting comes from an ML_-prefixed environment variable (as
    # docker-compose.yml sets them: ML_ENVIRONMENT, ML_LOG_LEVEL,
    # ML_MODELS_DIR, ...), validated once at import time.
    model_config = SettingsConfigDict(
        env_prefix="ML_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def models_path(self) -> Path:
        return Path(self.models_dir)


settings = Settings()
