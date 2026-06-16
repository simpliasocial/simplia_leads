import unittest
from unittest.mock import patch

from app.main import process_job


def document(source_id: str, source_type: str, text: str) -> dict:
    return {
        "sourceId": source_id,
        "sourceType": source_type,
        "url": f"https://example.com/{source_id}",
        "title": source_type,
        "extractedText": text,
        "rawContent": text,
        "contentType": "text/plain",
        "contentHash": f"hash-{source_id}",
        "capturedAt": "2026-06-15T00:00:00Z",
        "metadata": {},
    }


class FakeApi:
    def __init__(self):
        self.calls = []

    def call(self, action: str, **payload):
        self.calls.append((action, payload))
        if action == "get_worker_normalization_documents":
            return {
                "websiteCompleted": True,
                "documents": [document("website-1", "website", "Sitio web principal")],
            }
        return {}


class WorkerIntegrationTests(unittest.TestCase):
    @patch("app.main.normalize_context")
    @patch("app.main.scrape_social")
    def test_social_retry_rebuilds_context_with_existing_website_documents(self, scrape_social, normalize_context):
        scrape_social.return_value = [document("social-1", "facebook", "Contenido social nuevo")]
        normalize_context.return_value = ([{"key": "commercial_name"}], None, "input-hash")
        api = FakeApi()

        process_job(api, {
            "msg_id": 123,
            "message": {
                "projectId": "project-1",
                "runId": "run-1",
                "mode": "source_retry",
                "sources": [{"id": "social-1", "type": "facebook", "url": "https://facebook.com/example"}],
                "limits": {"maxPages": 5, "maxDepth": 1},
            },
        })

        normalized_documents = normalize_context.call_args.args[0]
        self.assertEqual({item["sourceType"] for item in normalized_documents}, {"website", "facebook"})
        complete_payload = next(payload for action, payload in api.calls if action == "complete_worker_job")
        self.assertEqual(complete_payload["contextFields"], [{"key": "commercial_name"}])
        self.assertEqual(complete_payload["sourceResults"][0]["status"], "completed")


if __name__ == "__main__":
    unittest.main()
