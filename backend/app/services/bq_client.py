"""Shared BigQuery client singleton used by both Pillar 01 and Pillar 02."""

from typing import Optional
from google.cloud import bigquery
from app.config import get_settings

_client: Optional[bigquery.Client] = None


def get_client() -> bigquery.Client:
    global _client
    if _client is None:
        _client = bigquery.Client(project=get_settings().gcp_project_id)
    return _client
