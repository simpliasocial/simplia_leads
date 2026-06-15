from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass

import httpx

from .normalizer import normalize_context
from .security import UnsafeUrlError, normalize_public_url
from .social import PlatformBlockedError, scrape_social


@dataclass
class WorkerConfig:
    supabase_url: str
    supabase_anon_key: str
    worker_secret: str
    poll_seconds: float = 5.0

    @classmethod
    def from_env(cls) -> "WorkerConfig":
        config = cls(
            supabase_url=os.environ["SUPABASE_URL"].rstrip("/"),
            supabase_anon_key=os.environ["SUPABASE_ANON_KEY"],
            worker_secret=os.environ["BRE_WORKER_SECRET"],
            poll_seconds=float(os.getenv("BRE_POLL_SECONDS", "5")),
        )
        return config


class BreApi:
    def __init__(self, config: WorkerConfig):
        self.endpoint = f"{config.supabase_url}/functions/v1/onboarding-bre-api"
        self.client = httpx.Client(
            timeout=60,
            headers={
                "apikey": config.supabase_anon_key,
                "Content-Type": "application/json",
                "x-bre-worker-secret": config.worker_secret,
            },
        )

    def call(self, action: str, **payload):
        response = self.client.post(self.endpoint, json={"action": action, **payload})
        response.raise_for_status()
        data = response.json()
        if data.get("error"):
            raise RuntimeError(data["error"])
        return data


def crawl_website(source: dict, limits: dict) -> tuple[list[dict], list[dict]]:
    payload = {
        "url": normalize_public_url(source["url"]),
        "maxPages": min(int(limits.get("maxPages", 50)), 50),
        "maxDepth": min(int(limits.get("maxDepth", 3)), 3),
    }
    process = subprocess.run(
        [sys.executable, "-m", "app.crawl_site"],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        timeout=900,
        check=False,
    )
    if process.returncode != 0:
        raise RuntimeError(process.stderr.strip()[-2000:] or "Website crawler failed")
    lines = [line for line in process.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("Website crawler returned no result")
    result = json.loads(lines[-1])
    documents = result.get("documents") or []
    if not documents:
        raise RuntimeError("Website did not expose crawlable public content")
    return documents, result.get("discoveredSources") or []


def process_job(api: BreApi, queue_job: dict) -> None:
    message_id = queue_job["msg_id"]
    message = queue_job["message"]
    project_id = message["projectId"]
    run_id = message["runId"]
    sources = message.get("sources") or []
    limits = message.get("limits") or {"maxPages": 50, "maxDepth": 3}
    documents: list[dict] = []
    discovered_sources: list[dict] = []
    source_results: list[dict] = []
    total_pages = 0
    completed = 0
    api.call("update_worker_progress", projectId=project_id, runId=run_id, pagesProcessed=0, sourcesCompleted=0)

    queued_source_ids = {source["id"] for source in sources}
    for source in sources:
        source_id = source["id"]
        source_type = source["type"]
        api.call(
            "update_worker_progress",
            projectId=project_id,
            runId=run_id,
            sourceId=source_id,
            sourceStatus="processing",
            pagesProcessed=total_pages,
            sourcesCompleted=completed,
        )
        try:
            normalize_public_url(source["url"])
            if source_type == "website":
                source_documents, discovered = crawl_website(source, limits)
                discovered_sources.extend(discovered)
                if discovered:
                    registered = api.call(
                        "register_discovered_sources",
                        projectId=project_id,
                        runId=run_id,
                        sources=discovered,
                    ).get("sources", [])
                    for discovered_source in registered:
                        if discovered_source["id"] not in queued_source_ids:
                            queued_source_ids.add(discovered_source["id"])
                            sources.append(discovered_source)
            else:
                source_documents = scrape_social(source_type, source["url"])
            for document in source_documents:
                document["sourceId"] = source_id
                document["sourceType"] = source_type
            documents.extend(source_documents)
            pages = len(source_documents)
            total_pages += pages
            completed += 1
            result = {
                "sourceId": source_id,
                "sourceType": source_type,
                "status": "completed",
                "pagesProcessed": pages,
            }
        except PlatformBlockedError as exc:
            result = {
                "sourceId": source_id,
                "sourceType": source_type,
                "status": "platform_blocked",
                "pagesProcessed": 0,
                "errorCode": "platform_blocked",
                "errorMessage": str(exc),
            }
        except UnsafeUrlError as exc:
            result = {
                "sourceId": source_id,
                "sourceType": source_type,
                "status": "failed",
                "pagesProcessed": 0,
                "errorCode": "unsafe_url",
                "errorMessage": str(exc),
            }
        except Exception as exc:
            result = {
                "sourceId": source_id,
                "sourceType": source_type,
                "status": "failed",
                "pagesProcessed": 0,
                "errorCode": "extraction_failed",
                "errorMessage": str(exc)[:1000],
            }
        source_results.append(result)
        api.call(
            "update_worker_progress",
            projectId=project_id,
            runId=run_id,
            sourceId=source_id,
            sourceStatus=result["status"],
            sourcePagesProcessed=result["pagesProcessed"],
            errorCode=result.get("errorCode"),
            errorMessage=result.get("errorMessage"),
            pagesProcessed=total_pages,
            sourcesCompleted=completed,
        )

    website_ok = any(item["sourceType"] == "website" and item["status"] == "completed" for item in source_results)
    context_fields = []
    ai_error = None
    ai_input_hash = None
    if website_ok:
        context_fields, ai_error, ai_input_hash = normalize_context(documents)
    api.call(
        "complete_worker_job",
        messageId=message_id,
        projectId=project_id,
        runId=run_id,
        sourceResults=source_results,
        documents=documents,
        discoveredSources=discovered_sources,
        contextFields=context_fields,
        aiModel=os.getenv("BRE_NORMALIZATION_MODEL", "gpt-5.4"),
        aiError=ai_error,
        aiInputHash=ai_input_hash,
    )


def main() -> int:
    config = WorkerConfig.from_env()
    api = BreApi(config)
    while True:
        try:
            job = api.call("claim_worker_job", visibilityTimeout=1800).get("job")
            if not job:
                time.sleep(config.poll_seconds)
                continue
            try:
                process_job(api, job)
            except Exception as exc:
                message = job.get("message") or {}
                api.call(
                    "fail_worker_job",
                    messageId=job.get("msg_id"),
                    projectId=message.get("projectId"),
                    runId=message.get("runId"),
                    errorCode="worker_failed",
                    errorMessage=str(exc)[:2000],
                )
        except KeyboardInterrupt:
            return 0
        except Exception as exc:
            print(f"Worker loop error: {exc}", file=sys.stderr, flush=True)
            time.sleep(max(config.poll_seconds, 5))


if __name__ == "__main__":
    raise SystemExit(main())
