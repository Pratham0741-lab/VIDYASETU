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
    glare_pixel_threshold: int = 245  # Pixel brightness considered saturated white (0-255)
    glare_ratio_threshold: float = 0.05  # Fraction of image allowed to be glare before flagged
    border_blank_variance_threshold: float = 8.0  # Heuristic threshold for edge blank borders

    # Classification Thresholds
    classify_min_confidence: float = 0.40
    classify_temperature: float = 6.0  # Softmax temperature for continuous, un-snapped posterior probabilities

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
