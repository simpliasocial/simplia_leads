import json
import unittest
from unittest.mock import patch

from app.social import _extract_readable_text, scrape_social, scrape_tiktok
from app.social import PartialExtractionError, PlatformBlockedError, fetch_public_html


class SocialExtractionTests(unittest.TestCase):
    @patch("app.social.trafilatura.extract", return_value="")
    def test_uses_visible_text_when_article_extraction_is_empty(self, _extract):
        raw = "<html><body><main>Contenido publico renderizado para describir el negocio y sus servicios principales.</main></body></html>"

        text = _extract_readable_text(raw, "https://example.com/")

        self.assertIn("Contenido publico renderizado", text)

    @patch("app.social.httpx.Client")
    @patch("app.social._yt_dlp_metadata", side_effect=RuntimeError("This account does not have any videos posted"))
    def test_tiktok_profile_without_videos_uses_public_profile_json(self, _metadata, client):
        payload = {
            "__DEFAULT_SCOPE__": {
                "webapp.user-detail": {
                    "userInfo": {
                        "user": {"uniqueId": "simplia.social", "nickname": "Simplia", "signature": "Automatizacion"},
                        "stats": {"followerCount": 10, "videoCount": 0},
                    }
                }
            }
        }
        response = client.return_value.__enter__.return_value.get.return_value
        response.text = f'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{json.dumps(payload)}</script>'
        response.raise_for_status.return_value = None

        [document] = scrape_tiktok("https://www.tiktok.com/@simplia.social")

        self.assertEqual(document["metadata"]["username"], "simplia.social")
        self.assertEqual(document["metadata"]["videos"], 0)
        self.assertIn("Automatizacion", document["extractedText"])

    @patch("app.social.httpx.Client")
    def test_tiktok_profile_without_public_metadata_is_partial_valid_source(self, client):
        response = client.return_value.__enter__.return_value.get.return_value
        response.text = "<html><body>Perfil publico existente sin metadata util.</body></html>"
        response.raise_for_status.return_value = None

        with self.assertRaises(PartialExtractionError) as caught:
            scrape_tiktok("https://www.tiktok.com/@simplia.social")

        self.assertIn("TikTok no expuso datos públicos utilizables", str(caught.exception))
        self.assertEqual(caught.exception.documents[0]["metadata"]["username"], "simplia.social")
        self.assertTrue(caught.exception.documents[0]["metadata"]["noPublicData"])

    @patch("app.social.httpx.Client")
    def test_linkedin_private_status_is_platform_blocked(self, client):
        response = client.return_value.__enter__.return_value.get.return_value
        response.status_code = 999

        with self.assertRaises(PlatformBlockedError):
            fetch_public_html("https://www.linkedin.com/in/example")

    @patch("app.social.fetch_public_html", side_effect=PlatformBlockedError("Platform requires authentication"))
    def test_optional_social_blocked_source_becomes_partial_valid_source(self, _fetch):
        with self.assertRaises(PartialExtractionError) as caught:
            scrape_social("linkedin", "https://www.linkedin.com/in/example")

        self.assertIn("LinkedIn no expuso datos públicos utilizables", str(caught.exception))
        self.assertEqual(caught.exception.documents[0]["metadata"]["sourceType"], "linkedin")
        self.assertTrue(caught.exception.documents[0]["metadata"]["noPublicData"])

    @patch("app.social.fetch_public_html", side_effect=PlatformBlockedError("Public page did not expose readable content"))
    def test_other_public_source_without_readable_content_becomes_partial(self, _fetch):
        with self.assertRaises(PartialExtractionError) as caught:
            scrape_social("other", "https://example.com/profile")

        self.assertIn("La fuente pública no expuso datos públicos utilizables", str(caught.exception))
        self.assertEqual(caught.exception.documents[0]["metadata"]["sourceType"], "other")


if __name__ == "__main__":
    unittest.main()
