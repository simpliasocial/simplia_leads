from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Literal

from openai import OpenAI
from pydantic import BaseModel, Field


ALLOWED_CATEGORIES = {
    "identity", "classification", "offer", "icp", "communication", "faqs",
    "locations", "hours", "contacts", "marketing", "legal",
}

REQUIRED_DYNAMIC_FIELDS = {
    "commercial_name",
    "business_description",
    "industry",
    "country",
    "value_proposition",
    "primary_offers",
    "benefits",
    "ideal_customer_profile",
    "communication_tone",
}

ALL_DYNAMIC_FIELDS = REQUIRED_DYNAMIC_FIELDS | {"general_restrictions", "faqs"}


class NormalizedField(BaseModel):
    key: str
    category: str
    value: Any = None
    origin: Literal["extracted", "inferred"]
    confidence: Literal["high", "medium", "low"] | None = None
    status: Literal["extracted", "inferred", "not_found", "pending_validation"]
    contradiction: bool = False
    alternatives: list[Any] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    required_for_base: bool = False


class NormalizedContext(BaseModel):
    fields: list[NormalizedField]


def _doc_catalog(documents: list[dict]) -> tuple[list[dict], str]:
    catalog = []
    blocks = []
    budget = 120_000
    for index, document in enumerate(documents):
        if budget <= 0:
            break
        text = str(document.get("extractedText") or "").strip()
        if not text:
            continue
        excerpt = text[: min(12_000, budget)]
        budget -= len(excerpt)
        evidence_id = f"DOC_{index + 1}"
        catalog.append({"id": evidence_id, **document})
        blocks.append(f"[{evidence_id}] URL: {document.get('url')}\nTITLE: {document.get('title', '')}\nTEXT:\n{excerpt}")
    return catalog, "\n\n".join(blocks)


def _fallback(documents: list[dict]) -> list[dict]:
    first = next((item for item in documents if item.get("extractedText")), None)
    title = (first or {}).get("title") or None
    description = ((first or {}).get("extractedText") or "")[:700] or None
    values = {
        "commercial_name": (title, "identity"),
        "business_description": (description, "identity"),
        "industry": (None, "classification"),
        "country": (None, "identity"),
        "value_proposition": (None, "offer"),
        "primary_offers": (None, "offer"),
        "benefits": (None, "offer"),
        "general_restrictions": (None, "offer"),
        "ideal_customer_profile": (None, "icp"),
        "communication_tone": (None, "communication"),
        "faqs": (None, "faqs"),
    }
    fields = []
    for key, (value, category) in values.items():
        evidence = []
        if value and first:
            evidence.append({
                "sourceId": first.get("sourceId"),
                "url": first.get("url"),
                "sourceType": first.get("sourceType", "website"),
                "originalText": str(first.get("extractedText") or "")[:1200],
                "capturedAt": first.get("capturedAt"),
                "contentHash": first.get("contentHash"),
            })
        fields.append({
            "key": key,
            "category": category,
            "value": value,
            "origin": "extracted",
            "confidence": "low" if value else None,
            "status": "pending_validation" if value else "not_found",
            "contradiction": False,
            "alternatives": [],
            "evidence": evidence,
            "requiredForBase": key in REQUIRED_DYNAMIC_FIELDS or key == "faqs",
        })
    return fields


def normalize_context(documents: list[dict]) -> tuple[list[dict], str | None, str]:
    catalog, prompt_documents = _doc_catalog(documents)
    model = os.getenv("BRE_NORMALIZATION_MODEL", "gpt-5.4")
    input_hash = hashlib.sha256(prompt_documents.encode("utf-8")).hexdigest()
    if not os.getenv("OPENAI_API_KEY") or not prompt_documents:
        return _fallback(documents), "OPENAI_API_KEY is not configured; deterministic fallback used", input_hash

    instructions = """
You normalize public business information for a base-context onboarding.
Return structured fields covering identity, classification, offer, inferred ICP, communication,
candidate FAQs, possible locations, visible hours, contacts, marketing, and legal context.
Every factual extracted value must cite one or more provided DOC ids. Never invent evidence.
Use origin=inferred for hypotheses, including ICP and any classification not literally stated.
Every inferred field must use status=inferred even at high confidence.
Extracted high-confidence literal values may use status=extracted. Medium/low extracted values use
status=pending_validation. Contradictions must preserve alternatives and contradiction=true.
Include all eleven dynamic fields. Set required_for_base=true for commercial_name,
business_description, industry, country, value_proposition, primary_offers, benefits,
ideal_customer_profile and communication_tone. Set it for general_restrictions only when the
business appears to require a missing restriction. Set it for faqs when fewer than three useful
candidate FAQs can be produced. Missing optional fields may be not_found with required_for_base=false.
Locations and visible hours are context only, never confirmed branches, schedules or appointment data.
Do not produce objectives, appointments, meetings, calendars, gates, filters, legal consent decisions,
emoji preferences, templates, or pipeline matching configuration.
""".strip()
    client = OpenAI()
    response = client.responses.parse(
        model=model,
        input=[
            {"role": "system", "content": instructions},
            {"role": "user", "content": prompt_documents},
        ],
        text_format=NormalizedContext,
    )
    parsed = response.output_parsed
    if not parsed:
        return _fallback(documents), "OpenAI returned no structured output; deterministic fallback used", input_hash
    by_id = {item["id"]: item for item in catalog}
    fields = []
    seen = set()
    for item in parsed.fields:
        if item.category not in ALLOWED_CATEGORIES or not item.key:
            continue
        seen.add(item.key)
        evidence = []
        for evidence_id in item.evidence_ids:
            document = by_id.get(evidence_id)
            if not document:
                continue
            original_text = str(document.get("extractedText") or "")[:1200]
            evidence.append({
                "sourceId": document.get("sourceId"),
                "url": document.get("url"),
                "sourceType": document.get("sourceType", "other"),
                "originalText": original_text,
                "capturedAt": document.get("capturedAt"),
                "contentHash": document.get("contentHash"),
            })
        inferred = item.origin == "inferred" or (item.value is not None and item.status != "not_found" and not evidence)
        status = "inferred" if inferred else item.status
        if not inferred and item.confidence != "high" and status == "extracted":
            status = "pending_validation"
        fields.append({
            "key": item.key,
            "category": item.category,
            "value": item.value,
            "origin": "inferred" if inferred else "extracted",
            "confidence": item.confidence,
            "status": status,
            "contradiction": item.contradiction,
            "alternatives": [{"value": alternative} for alternative in item.alternatives],
            "evidence": evidence,
            "requiredForBase": item.required_for_base,
        })
    for missing_key in ALL_DYNAMIC_FIELDS - seen:
        category = "faqs" if missing_key == "faqs" else "offer" if missing_key in {"value_proposition", "primary_offers", "benefits", "general_restrictions"} else "identity"
        fields.append({
            "key": missing_key,
            "category": category,
            "value": None,
            "origin": "extracted",
            "confidence": None,
            "status": "not_found",
            "contradiction": False,
            "alternatives": [],
            "evidence": [],
            "requiredForBase": missing_key in REQUIRED_DYNAMIC_FIELDS or missing_key == "faqs",
        })
    return fields, None, input_hash
