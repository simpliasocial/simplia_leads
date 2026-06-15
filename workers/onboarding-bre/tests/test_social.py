import unittest
from unittest.mock import patch

from app.social import PartialExtractionError, _extract_readable_text, scrape_tiktok
from app.social import PlatformBlockedError, fetch_public_html


class SocialExtractionTests(unittest.TestCase):
    @patch("app.social.trafilatura.extract", return_value="")
    def test_uses_visible_text_when_article_extraction_is_empty(self, _extract):
        raw = "<html><body><main>Contenido publico renderizado para describir el negocio y sus servicios principales.</main></body></html>"

        text = _extract_readable_text(raw, "https://example.com/")

        self.assertIn("Contenido publico renderizado", text)

    @patch("app.social._yt_dlp_metadata", side_effect=RuntimeError("This account does not have any videos posted"))
    def test_tiktok_profile_without_videos_is_partial(self, _metadata):
        with self.assertRaises(PartialExtractionError) as raised:
            scrape_tiktok("https://www.tiktok.com/@simplia.social")

        document = raised.exception.documents[0]
        self.assertEqual(document["metadata"]["username"], "simplia.social")
        self.assertEqual(document["metadata"]["extractionStatus"], "no_public_videos")

    @patch("app.social.httpx.Client")
    def test_linkedin_private_status_is_platform_blocked(self, client):
        response = client.return_value.__enter__.return_value.get.return_value
        response.status_code = 999

        with self.assertRaises(PlatformBlockedError):
            fetch_public_html("https://www.linkedin.com/in/example")


if __name__ == "__main__":
    unittest.main()
