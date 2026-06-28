"""Shared BigQuery client singleton used by both Pillar 01 and Pillar 02."""

from typing import Optional
from google.cloud import bigquery
from app.config import get_settings

_client: Optional[bigquery.Client] = None


def get_client() -> bigquery.Client:
    global _client
    if _client is None:
        s = get_settings()
        # default_query_job_config applies the byte cap to every query that
        # doesn't pass its own job_config (i.e. the analytics full scans).
        # ponytail: parametrized queries set their own config and opt out, but
        # those are id-bounded (UNNEST(@ids)) so they aren't the runaway risk.
        _client = bigquery.Client(
            project=s.gcp_project_id,
            default_query_job_config=bigquery.QueryJobConfig(
                maximum_bytes_billed=s.bq_max_bytes_billed
            ),
        )
    return _client
