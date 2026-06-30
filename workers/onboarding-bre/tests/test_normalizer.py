import os
import unittest
from unittest.mock import patch

from app.field_catalog import FIELD_SPECS
from app.normalizer import NormalizedContext, normalize_context


DOCUMENT = {
    "sourceId": "source-1",
    "sourceType": "website",
    "url": "https://example.com/",
    "title": "Empresa Ejemplo",
    "extractedText": "Empresa Ejemplo ofrece automatizacion comercial para empresas en Ecuador.",
    "capturedAt": "2026-06-15T00:00:00Z",
    "contentHash": "hash-1",
}


class NormalizerTests(unittest.TestCase):
    def test_structured_output_schema_types_json_values(self):
        schema = NormalizedContext.model_json_schema()
        field_schema = schema["$defs"]["NormalizedField"]["properties"]

        self.assertIn("anyOf", field_schema["value"])
        self.assertEqual(field_schema["alternatives"]["items"]["type"], "string")
        self.assertEqual(field_schema["evidence"]["items"]["$ref"], "#/$defs/EvidenceReference")

    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"})
    @patch("app.normalizer.OpenAI", side_effect=RuntimeError("invalid schema"))
    def test_openai_error_returns_fallback_context(self, _openai):
        fields, error, input_hash = normalize_context([DOCUMENT])

        self.assertEqual(len(fields), len(FIELD_SPECS))
        self.assertIn("deterministic fallback used", error)
        self.assertTrue(input_hash)

    @patch.dict(os.environ, {}, clear=True)
    def test_fallback_persists_every_document_field_as_found_or_not_found(self):
        fields, _, _ = normalize_context([DOCUMENT])

        self.assertEqual({field["key"] for field in fields}, set(FIELD_SPECS))
        self.assertEqual(next(field for field in fields if field["key"] == "legal_name")["status"], "not_found")

    @patch.dict(os.environ, {}, clear=True)
    def test_fallback_builds_candidate_faqs_from_public_context(self):
        fields, _, _ = normalize_context([DOCUMENT])
        faqs = next(field for field in fields if field["key"] == "faqs")

        self.assertEqual(faqs["origin"], "inferred")
        self.assertEqual(faqs["status"], "inferred")
        self.assertGreaterEqual(len(faqs["value"]), 3)
        self.assertLessEqual(len(faqs["value"]), 20)
        self.assertTrue(all("Respuesta:" in item for item in faqs["value"]))
        self.assertTrue(any(item.startswith("¿Qué servicios o productos ofrece la empresa? Respuesta:") for item in faqs["value"]))


if __name__ == "__main__":
    unittest.main()
